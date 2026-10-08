// extension-host.rs -- lanzador nativo (.exe) del host de mensajeria propia de
// ComputerUser.
//
// Chrome/Brave/Edge lanzan los native messaging hosts con CreateProcessW, que
// NO puede ejecutar .cmd/.bat/.mjs: el `path` del manifiesto tiene que ser una
// imagen ejecutable. Este shim hace una sola cosa: arrancar `src\host.mjs` con
// el `node.exe` del runtime heredando stdin/stdout/stderr (el canal binario del
// navegador es el del host), y devolver el exit code del hijo.
//
// Este .exe SUSTITUYE al `extension-host.exe` de Codex. El binario original se
// conserva junto a el como `extension-host.exe.bak-codex` (reversion: copiarlo
// de vuelta encima).
//
// Compilar (sin cargo, sin crates, sin red):
//   rustc -O -o windows\x64\extension-host.exe launcher\extension-host.rs
//   (o: powershell -File launcher\build.ps1)
//
// Resolucion de rutas, relativa SIEMPRE al propio ejecutable (el navegador
// lanza el host con un cwd arbitrario, nunca se usa el cwd):
//
//   layout instalado:
//     <runtime>\extension-host\windows\x64\extension-host.exe   <- este .exe
//     <runtime>\extension-host\src\host.mjs                     <- el host
//     <runtime>\bin\node.exe                                    <- el runtime
//
//   node.exe    : %CU_HOST_NODE_EXE% > %PROTO_NODE_EXE% (compat. prototipo)
//                 > <exe>\node.exe
//                 > <exe>\..\..\..\bin\node.exe        (instalado)
//                 > <exe>\..\..\..\bin\x64\node.exe    (variante x64)
//                 > <exe>\..\..\bin\node.exe           (arbol de desarrollo)
//                 > node.exe del PATH
//   host script : %CU_HOST_SCRIPT% > %PROTO_HOST_SCRIPT% (compat. prototipo)
//                 > <exe>\..\src\host.mjs              (instalado)
//                 > <exe>\src\host.mjs                 (arbol de desarrollo)
//
// La linea de comandos que pone el navegador se reenvia tal cual:
//   extension-host.exe "chrome-extension://<id>/" --parent-window=<hwnd>
//
// CICLO DE VIDA DEL HIJO (v1.0.10, endurecido):
//   El hijo `node.exe` NO puede quedar huerfano sirviendo el pipe cuando el
//   navegador (o el usuario) mata el lanzador: TerminateProcess no da ocasion de
//   limpiar, asi que el aislamiento lo pone el kernel. Este .exe crea un Job
//   Object con JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE y mete en el al hijo. Cuando el
//   lanzador muere (de cualquier forma, incluido TerminateProcess) se cierra el
//   ultimo handle del job y Windows mata al hijo. El handle del job NO es
//   heredable, asi que el hijo no lo mantiene vivo.
//   Segunda red de seguridad en `src\host.mjs`: el hijo vigila a su padre
//   (process.ppid) y sale en cuanto desaparece.
use std::env;
use std::path::{Path, PathBuf};
use std::process::{exit, Command, Stdio};

// Marcador de identidad: permite comprobar con `findstr` que el .exe que el
// navegador esta lanzando es ESTE lanzador y no el binario de Codex.
const LAUNCHER_MARKER: &str = "ComputerUser native messaging launcher v1.0.10";
const LAUNCHER_ENV_QUIET: &str = "CU_HOST_QUIET";

// ---------------------------------------------------------------------------
// Job Object: el hijo muere con el lanzador (sin crates, solo kernel32)
// ---------------------------------------------------------------------------
#[cfg(windows)]
mod job {
    use std::ffi::c_void;

    type Handle = *mut c_void;

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
    const PROCESS_SET_QUOTA: u32 = 0x0100;
    const PROCESS_TERMINATE: u32 = 0x0001;

    #[repr(C)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: u32, info: *mut c_void, len: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
    }

    /// Job con KILL_ON_JOB_CLOSE: al morir este proceso se cierra el handle y
    /// Windows termina a todos los procesos del job.
    pub struct KillOnCloseJob {
        handle: Handle,
    }

    impl KillOnCloseJob {
        pub fn create() -> Option<KillOnCloseJob> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if handle.is_null() {
                    return None;
                }
                let mut info: ExtendedLimitInformation = std::mem::zeroed();
                info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                    &mut info as *mut ExtendedLimitInformation as *mut c_void,
                    std::mem::size_of::<ExtendedLimitInformation>() as u32,
                );
                if ok == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(KillOnCloseJob { handle })
            }
        }

        /// Mete el proceso `pid` en el job. Devuelve false si no se pudo.
        pub fn assign(&self, pid: u32) -> bool {
            unsafe {
                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if process.is_null() {
                    return false;
                }
                let ok = AssignProcessToJobObject(self.handle, process);
                CloseHandle(process);
                ok != 0
            }
        }
    }

    impl Drop for KillOnCloseJob {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

fn exe_dir() -> PathBuf {
    let exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    exe.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

fn env_file(name: &str) -> Option<PathBuf> {
    match env::var(name) {
        Ok(v) if !v.trim().is_empty() => {
            let p = PathBuf::from(v);
            if p.is_file() {
                Some(p)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// <exe>\..\, <exe>\..\..\, ... hasta `levels` niveles.
fn up(dir: &Path, levels: usize) -> PathBuf {
    let mut p = dir.to_path_buf();
    for _ in 0..levels {
        p = p.join("..");
    }
    p
}

fn main() {
    let dir = exe_dir();
    let args: Vec<String> = env::args().skip(1).collect();
    let quiet = env::var(LAUNCHER_ENV_QUIET).map(|v| v == "1").unwrap_or(false);

    let node = env_file("CU_HOST_NODE_EXE")
        .or_else(|| env_file("PROTO_NODE_EXE"))
        .or_else(|| {
            first_existing(&[
                dir.join("node.exe"),
                up(&dir, 3).join("bin").join("node.exe"),
                up(&dir, 3).join("bin").join("x64").join("node.exe"),
                up(&dir, 2).join("bin").join("node.exe"),
                up(&dir, 1).join("bin").join("node.exe"),
            ])
        })
        .unwrap_or_else(|| PathBuf::from("node.exe"));

    let script = env_file("CU_HOST_SCRIPT")
        .or_else(|| env_file("PROTO_HOST_SCRIPT"))
        .or_else(|| {
            first_existing(&[
                up(&dir, 1).join("src").join("host.mjs"),
                dir.join("src").join("host.mjs"),
                up(&dir, 2).join("src").join("host.mjs"),
                up(&dir, 3).join("src").join("host.mjs"),
            ])
        })
        .unwrap_or_else(|| up(&dir, 1).join("src").join("host.mjs"));

    let mut cmd = Command::new(&node);
    cmd.arg(&script);
    for a in &args {
        cmd.arg(a);
    }
    // stdio heredado: los pipes del navegador son los del host. Este shim no
    // escribe NUNCA en stdout (es un canal binario); solo stderr para trazas.
    cmd.stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    if !quiet {
        eprintln!(
            "[cu-host-exe] {}\n[cu-host-exe] node={} script={} argv={:?}",
            LAUNCHER_MARKER,
            node.display(),
            script.display(),
            args
        );
    }

    // Si no podemos ni arrancar node, mejor morir de forma visible que dejar al
    // navegador con un host mudo.
    if !script.is_file() && !quiet {
        eprintln!("[cu-host-exe] WARNING: host script not found at {}", script.display());
    }

    // Job Object ANTES de arrancar al hijo: en cuanto exista el hijo se mete en
    // el job, de modo que si este lanzador desaparece el kernel lo mata.
    #[cfg(windows)]
    let kill_on_close = job::KillOnCloseJob::create();
    #[cfg(windows)]
    if kill_on_close.is_none() && !quiet {
        eprintln!("[cu-host-exe] WARNING: no se pudo crear el Job Object; el hijo podria quedar huerfano");
    }

    match cmd.spawn() {
        Ok(mut child) => {
            #[cfg(windows)]
            {
                let pid = child.id();
                match &kill_on_close {
                    Some(job) => {
                        if !job.assign(pid) && !quiet {
                            eprintln!(
                                "[cu-host-exe] WARNING: no se pudo meter el hijo {} en el Job Object",
                                pid
                            );
                        }
                    }
                    None => {}
                }
            }
            match child.wait() {
                Ok(status) => exit(status.code().unwrap_or(0)),
                Err(e) => {
                    eprintln!("[cu-host-exe] failed to wait for host: {e}");
                    exit(4);
                }
            }
        }
        Err(e) => {
            eprintln!(
                "[cu-host-exe] failed to spawn {} {}: {e}",
                node.display(),
                script.display()
            );
            exit(3);
        }
    }
}
