use std::process::Command;
use std::path::Path;
use uuid::Uuid;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn select_download_path() -> Result<String, String> {
    // 使用系统的文件夹选择对话框
    let result = rfd::AsyncFileDialog::new()
        .set_title("选择下载文件夹")
        .pick_folder()
        .await;
        
    match result {
        Some(folder) => Ok(folder.path().to_string_lossy().to_string()),
        None => Err("未选择文件夹".to_string())
    }
}

#[tauri::command]
async fn download_video(url: String, download_path: Option<String>) -> Result<String, String> {
    let output_dir = if let Some(path) = download_path {
        std::path::PathBuf::from(path)
    } else {
        std::env::temp_dir()
    };
    
    let unique_id = Uuid::new_v4();
    let output_path = output_dir.join(format!("video_{}", unique_id));
    
    std::fs::create_dir_all(&output_path)
        .map_err(|e| format!("创建目录失败: {}", e))?;
    
    let output = Command::new("yt-dlp")
        .arg("--extract-audio")
        .arg("--audio-format").arg("wav")
        .arg("--output").arg(format!("{}/%(title)s.%(ext)s", output_path.display()))
        .arg(&url)
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                if let Some(audio_file) = find_audio_file(&output_path) {
                    Ok(format!("音频文件已下载到: {}", audio_file))
                } else {
                    Err(format!("未找到下载的音频文件，查找目录: {}", output_path.display()))
                }
            } else {
                let error = String::from_utf8_lossy(&result.stderr);
                Err(format!("yt-dlp 错误: {}", error))
            }
        }
        Err(e) => Err(format!("执行 yt-dlp 失败: {}. 请确保已安装 yt-dlp", e))
    }
}

fn find_audio_file(dir: &Path) -> Option<String> {
    if !dir.exists() {
        return None;
    }
    
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(extension) = path.extension() {
                if extension == "wav" {
                    return path.to_string_lossy().to_string().into();
                }
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, select_download_path, download_video])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
