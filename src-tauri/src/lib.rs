use std::process::Command;
use std::path::{Path, PathBuf};
use std::fs;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone)]
struct VideoRecord {
    id: String,
    url: String,
    title: Option<String>,
    downloaded: bool,
    transcribed: bool,
    summarized: bool,
    audio_file: Option<String>,
    transcript_file: Option<String>,
    transcript_content: Option<String>,
    summary_content: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize)]
struct Vault {
    videos: HashMap<String, VideoRecord>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn generate_video_id(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let result = hasher.finalize();
    format!("{:x}", result)[..16].to_string() // 取前16位作为ID
}

fn expand_tilde_path(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home_dir) = std::env::var_os("HOME") {
            let home_path = std::path::Path::new(&home_dir);
            return home_path.join(&path[2..]).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

fn get_vault_path(base_path: &str) -> PathBuf {
    PathBuf::from(base_path).join("video-transcriber-vault")
}

fn get_vault_config_path(vault_path: &PathBuf) -> PathBuf {
    vault_path.join("vault.toml")
}

fn get_video_dir_path(vault_path: &PathBuf, video_id: &str) -> PathBuf {
    vault_path.join(video_id)
}

fn load_vault(vault_path: &PathBuf) -> Result<Vault, String> {
    let config_path = get_vault_config_path(vault_path);
    
    if !config_path.exists() {
        // 创建新的vault
        return Ok(Vault {
            videos: HashMap::new(),
        });
    }
    
    match fs::read_to_string(&config_path) {
        Ok(content) => {
            match toml::from_str::<Vault>(&content) {
                Ok(vault) => Ok(vault),
                Err(e) => Err(format!("解析vault配置失败: {}", e))
            }
        }
        Err(e) => Err(format!("读取vault配置失败: {}", e))
    }
}

fn save_vault(vault_path: &PathBuf, vault: &Vault) -> Result<(), String> {
    fs::create_dir_all(vault_path)
        .map_err(|e| format!("创建vault目录失败: {}", e))?;
    
    let config_path = get_vault_config_path(vault_path);
    let content = toml::to_string_pretty(vault)
        .map_err(|e| format!("序列化vault配置失败: {}", e))?;
    
    fs::write(&config_path, content)
        .map_err(|e| format!("保存vault配置失败: {}", e))
}

fn get_current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    timestamp.to_string()
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
async fn process_video_pipeline(url: String, base_path: Option<String>, api_key: Option<String>, api_provider: Option<String>) -> Result<String, String> {
    let base_dir = base_path.unwrap_or_else(|| std::env::temp_dir().to_string_lossy().to_string());
    
    // 展开波浪号路径 (~/Downloads -> /Users/username/Downloads)
    let expanded_base_dir = expand_tilde_path(&base_dir);
    
    let vault_path = get_vault_path(&expanded_base_dir);
    let video_id = generate_video_id(&url);
    
    // 加载vault
    let mut vault = load_vault(&vault_path)?;
    
    let timestamp = get_current_timestamp();
    
    // 检查是否已有记录
    let mut record = vault.videos.get(&video_id).cloned().unwrap_or_else(|| VideoRecord {
        id: video_id.clone(),
        url: url.clone(),
        title: None,
        downloaded: false,
        transcribed: false,
        summarized: false,
        audio_file: None,
        transcript_file: None,
        transcript_content: None,
        summary_content: None,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    });
    
    let video_dir = get_video_dir_path(&vault_path, &video_id);
    fs::create_dir_all(&video_dir)
        .map_err(|e| format!("创建视频目录失败: {}", e))?;
    
    let mut results = Vec::new();
    
    // 如果记录显示已下载但缺少 audio_file 路径，尝试找到文件
    if record.downloaded && record.audio_file.is_none() {
        if let Some(audio_file) = find_audio_file(&video_dir) {
            record.audio_file = Some(audio_file);
            record.updated_at = get_current_timestamp();
            vault.videos.insert(video_id.clone(), record.clone());
            save_vault(&vault_path, &vault)?;
            results.push("✅ 找到已存在的音频文件".to_string());
        }
    }
    
    // Step 1: 下载视频
    if !record.downloaded {
        results.push("正在下载视频...".to_string());
        match download_video_to_dir(&url, &video_dir).await {
            Ok((audio_file, title)) => {
                record.downloaded = true;
                record.audio_file = Some(audio_file.clone());
                record.title = Some(title);
                record.updated_at = get_current_timestamp();
                
                // 保存进度
                vault.videos.insert(video_id.clone(), record.clone());
                save_vault(&vault_path, &vault)?;
                
                results.push(format!("✅ 下载完成: {}", audio_file));
            }
            Err(e) => return Err(format!("下载失败: {}", e))
        }
    } else {
        results.push("✅ 视频已下载，跳过下载步骤".to_string());
    }
    
    // Step 2: 转录音频
    if !record.transcribed {
        if let Some(audio_file) = &record.audio_file {
            results.push("正在转录音频...".to_string());
            match transcribe_audio_file(audio_file).await {
                Ok(transcript_content) => {
                    record.transcribed = true;
                    record.transcript_content = Some(transcript_content.clone());
                    record.updated_at = get_current_timestamp();
                    
                    // 保存进度
                    vault.videos.insert(video_id.clone(), record.clone());
                    save_vault(&vault_path, &vault)?;
                    
                    results.push("✅ 转录完成".to_string());
                }
                Err(e) => return Err(format!("转录失败: {}", e))
            }
        } else {
            return Err("无法转录：未找到音频文件路径".to_string());
        }
    } else if record.transcribed {
        results.push("✅ 音频已转录，跳过转录步骤".to_string());
    }
    
    // Step 3: 生成总结
    if !record.summarized && record.transcript_content.is_some() {
        results.push("正在生成总结...".to_string());
        let transcript = record.transcript_content.as_ref().unwrap();
        let provider = match api_provider.as_deref() {
            Some("deepseek") => ApiProvider::DeepSeek,
            _ => ApiProvider::OpenAI,
        };
        match summarize_transcript_content(transcript, api_key, provider).await {
            Ok(summary_content) => {
                record.summarized = true;
                record.summary_content = Some(summary_content);
                record.updated_at = get_current_timestamp();
                
                // 保存最终进度
                vault.videos.insert(video_id.clone(), record.clone());
                save_vault(&vault_path, &vault)?;
                
                results.push("✅ 总结完成".to_string());
            }
            Err(e) => return Err(format!("总结失败: {}", e))
        }
    } else if record.summarized {
        results.push("✅ 内容已总结，跳过总结步骤".to_string());
    }
    
    // 返回结果
    let result_json = serde_json::to_string(&record)
        .map_err(|e| format!("序列化结果失败: {}", e))?;
    
    Ok(result_json)
}

async fn download_video_to_dir(url: &str, output_dir: &PathBuf) -> Result<(String, String), String> {
    // 先检查yt-dlp是否可用
    let version_check = Command::new("yt-dlp")
        .arg("--version")
        .output();
        
    match version_check {
        Err(_) => return Err("yt-dlp未安装或不在PATH中。请先安装yt-dlp: pip install yt-dlp".to_string()),
        Ok(result) if !result.status.success() => {
            return Err("yt-dlp无法正常运行，请检查安装".to_string());
        }
        _ => {}
    }
    
    // 先获取视频信息（标题和可用性检查）
    let info_output = Command::new("yt-dlp")
        .arg("--print").arg("%(title)s")
        .arg("--no-download")
        .arg(url)
        .output();
        
    let title = match info_output {
        Ok(result) if result.status.success() => {
            String::from_utf8_lossy(&result.stdout).trim().to_string()
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(format!("无法获取视频信息: {}", stderr));
        }
        Err(e) => return Err(format!("执行yt-dlp失败: {}", e))
    };
    
    // 下载并转换为音频
    let output = Command::new("yt-dlp")
        .arg("--extract-audio")
        .arg("--audio-format").arg("wav")
        .arg("--audio-quality").arg("0")  // 最高质量
        .arg("--output").arg(format!("{}/%(title)s.%(ext)s", output_dir.display()))
        .arg("--verbose")  // 详细输出用于调试
        .arg(url)
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);
            
            if result.status.success() {
                // 等待一小段时间确保文件写入完成
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
                
                if let Some(audio_file) = find_audio_file(output_dir) {
                    Ok((audio_file, title))
                } else {
                    // 如果找不到文件，提供详细的调试信息
                    let dir_contents = list_directory_contents(output_dir);
                    Err(format!(
                        "下载似乎成功但未找到音频文件。\n目录: {}\n目录内容: {:?}\n\nyt-dlp输出:\nSTDOUT: {}\nSTDERR: {}", 
                        output_dir.display(), 
                        dir_contents,
                        stdout.trim(),
                        stderr.trim()
                    ))
                }
            } else {
                Err(format!("yt-dlp下载失败 (退出码: {})\nSTDOUT: {}\nSTDERR: {}", 
                    result.status.code().unwrap_or(-1),
                    stdout.trim(),
                    stderr.trim()
                ))
            }
        }
        Err(e) => Err(format!("执行 yt-dlp 失败: {}", e))
    }
}

fn list_directory_contents(dir: &PathBuf) -> Vec<String> {
    if let Ok(entries) = fs::read_dir(dir) {
        entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect()
    } else {
        vec!["无法读取目录".to_string()]
    }
}

async fn transcribe_audio_file(audio_file_path: &str) -> Result<String, String> {
    // 使用 whisper 命令行工具进行转录
    let output = Command::new("whisper")
        .arg(audio_file_path)
        .arg("--model").arg("base")  // 使用 base 模型，平衡速度和准确性
        .arg("--output_format").arg("txt")  // 输出纯文本格式
        .arg("--output_dir").arg(std::path::Path::new(audio_file_path).parent().unwrap())
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                // 查找生成的转录文本文件
                if let Some(transcript_file) = find_transcript_file(audio_file_path) {
                    match fs::read_to_string(&transcript_file) {
                        Ok(content) => {
                            // 清理文本内容，移除多余的空白字符
                            let cleaned_content = content.trim().to_string();
                            Ok(cleaned_content)
                        }
                        Err(e) => Err(format!("读取转录文件失败: {}", e))
                    }
                } else {
                    Err("未找到转录输出文件".to_string())
                }
            } else {
                let error = String::from_utf8_lossy(&result.stderr);
                Err(format!("Whisper 转录失败: {}", error))
            }
        }
        Err(e) => Err(format!("执行 Whisper 失败: {}. 请确保已安装 OpenAI Whisper", e))
    }
}

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Clone)]
enum ApiProvider {
    OpenAI,
    DeepSeek,
}

impl ApiProvider {
    fn base_url(&self) -> &str {
        match self {
            ApiProvider::OpenAI => "https://api.openai.com/v1/chat/completions",
            ApiProvider::DeepSeek => "https://api.deepseek.com/chat/completions",
        }
    }
    
    fn default_model(&self) -> &str {
        match self {
            ApiProvider::OpenAI => "gpt-3.5-turbo",
            ApiProvider::DeepSeek => "deepseek-chat",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Serialize, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

async fn summarize_transcript_content(transcript: &str, api_key: Option<String>, provider: ApiProvider) -> Result<String, String> {
    // 如果没有提供API密钥，使用本地LLM或返回简单总结
    if api_key.is_none() {
        return Ok(generate_simple_summary(&transcript));
    }
    
    let api_key = api_key.unwrap();
    let client = reqwest::Client::new();
    
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: "你是一个专业的内容总结助手。请为用户提供简洁、准确的视频内容总结。总结应该包含主要观点、重要信息和关键结论。请用中文回复。".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("请总结以下视频转录内容，提取主要观点和重要信息：\n\n{}", transcript),
        },
    ];
    
    let request = ChatCompletionRequest {
        model: provider.default_model().to_string(),
        messages,
        max_tokens: 500,
        temperature: 0.7,
    };
    
    match client
        .post(provider.base_url())
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<ChatCompletionResponse>().await {
                    Ok(chat_response) => {
                        if let Some(choice) = chat_response.choices.first() {
                            Ok(choice.message.content.clone())
                        } else {
                            Err("API返回了空的总结结果".to_string())
                        }
                    }
                    Err(e) => Err(format!("解析API响应失败: {}", e)),
                }
            } else {
                Err(format!("API请求失败，状态码: {}", response.status()))
            }
        }
        Err(e) => {
            // 网络错误时回退到简单总结
            eprintln!("API调用失败，使用简单总结: {}", e);
            Ok(generate_simple_summary(&transcript))
        }
    }
}

fn generate_simple_summary(transcript: &str) -> String {
    let words: Vec<&str> = transcript.split_whitespace().collect();
    let total_words = words.len();
    
    if total_words == 0 {
        return "转录内容为空，无法生成总结。".to_string();
    }
    
    // 简单的总结：取前几句话
    let sentences: Vec<&str> = transcript.split('.').collect();
    let summary_sentences = sentences.iter()
        .take(3)
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim())
        .collect::<Vec<&str>>()
        .join("。");
    
    format!(
        "📊 内容统计：共约{}词\n\n📝 内容概要：\n{}\n\n💡 提示：配置OpenAI API密钥可获得更精准的AI总结", 
        total_words, 
        if summary_sentences.is_empty() { "转录内容较短，建议查看完整转录文本" } else { &summary_sentences }
    )
}

fn find_audio_file(dir: &Path) -> Option<String> {
    if !dir.exists() {
        return None;
    }
    
    let audio_extensions = ["wav", "mp3", "m4a", "aac", "flac", "ogg"];
    
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(extension) = path.extension() {
                    let ext_str = extension.to_string_lossy().to_lowercase();
                    if audio_extensions.contains(&ext_str.as_str()) {
                        return Some(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    None
}

fn find_transcript_file(audio_file_path: &str) -> Option<String> {
    let audio_path = Path::new(audio_file_path);
    let parent_dir = audio_path.parent()?;
    let stem = audio_path.file_stem()?.to_string_lossy();
    
    // Whisper 通常会生成与音频文件同名但扩展名为 .txt 的文件
    let transcript_path = parent_dir.join(format!("{}.txt", stem));
    
    if transcript_path.exists() {
        Some(transcript_path.to_string_lossy().to_string())
    } else {
        // 也尝试查找目录中的其他 .txt 文件
        if let Ok(entries) = std::fs::read_dir(parent_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(extension) = path.extension() {
                    if extension == "txt" {
                        return Some(path.to_string_lossy().to_string());
                    }
                }
            }
        }
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, select_download_path, process_video_pipeline])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
