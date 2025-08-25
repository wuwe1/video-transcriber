import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [videoUrl, setVideoUrl] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");

  async function selectDownloadPath() {
    try {
      const path = await invoke("select_download_path");
      setDownloadPath(path as string);
    } catch (error) {
      console.error("选择下载路径失败:", error);
      // 如果系统对话框失败，使用输入框作为备选方案
      const fallbackPath = prompt("系统文件选择器不可用。请手动输入下载文件夹路径:\n\n常用路径示例:\n• macOS: /Users/您的用户名/Downloads\n• Windows: C:\\Users\\您的用户名\\Downloads\n\n留空将使用系统临时目录");
      if (fallbackPath !== null) {
        setDownloadPath(fallbackPath.trim());
      }
    }
  }

  async function processVideo() {
    if (!videoUrl.trim()) return;
    
    setIsProcessing(true);
    setStatus("开始处理...");
    setTranscript("");
    setSummary("");

    try {
      setStatus("正在下载视频...");
      const audioFile = await invoke("download_video", { 
        url: videoUrl, 
        downloadPath: downloadPath || null 
      });
      
      setStatus(audioFile as string); // 显示下载位置信息
      
      setStatus("正在转录音频...");
      // TODO: 调用转录功能
      
      setStatus("正在生成总结...");
      // TODO: 调用总结功能
      
      setStatus("处理完成!");
    } catch (error) {
      setStatus(`错误: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main className="container">
      <h1>视频转录助手</h1>
      <p>输入YouTube或其他视频链接，自动转录并生成总结</p>

      <div className="input-section">
        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>下载路径:</label>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              type="text"
              value={downloadPath}
              placeholder="选择视频和音频文件的保存位置"
              readOnly
              disabled={isProcessing}
              style={{ 
                flex: 1, 
                padding: "8px", 
                backgroundColor: "#f8f8f8",
                border: "1px solid #ddd",
                borderRadius: "4px"
              }}
            />
            <button 
              onClick={selectDownloadPath}
              disabled={isProcessing}
              style={{ 
                padding: "8px 15px", 
                backgroundColor: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: isProcessing ? "not-allowed" : "pointer"
              }}
            >
              选择路径
            </button>
          </div>
        </div>

        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>视频URL:</label>
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="请输入视频URL (例如: https://www.youtube.com/watch?v=...)"
            disabled={isProcessing}
            style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "4px" }}
          />
        </div>
        
        <button 
          onClick={processVideo}
          disabled={isProcessing || !videoUrl.trim()}
          style={{ 
            padding: "12px 25px", 
            backgroundColor: isProcessing ? "#ccc" : "#007acc",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isProcessing ? "not-allowed" : "pointer",
            fontSize: "16px",
            fontWeight: "bold"
          }}
        >
          {isProcessing ? "处理中..." : "开始转录"}
        </button>
      </div>

      {status && (
        <div className="status" style={{ margin: "20px 0", padding: "10px", backgroundColor: "#f0f0f0", borderRadius: "4px" }}>
          <strong>状态：</strong>{status}
        </div>
      )}

      {transcript && (
        <div className="transcript-section" style={{ marginTop: "20px" }}>
          <h3>转录文本</h3>
          <div style={{ 
            backgroundColor: "#f8f8f8", 
            padding: "15px", 
            borderRadius: "4px", 
            maxHeight: "300px", 
            overflow: "auto",
            whiteSpace: "pre-wrap"
          }}>
            {transcript}
          </div>
        </div>
      )}

      {summary && (
        <div className="summary-section" style={{ marginTop: "20px" }}>
          <h3>AI总结</h3>
          <div style={{ 
            backgroundColor: "#e8f4fd", 
            padding: "15px", 
            borderRadius: "4px",
            whiteSpace: "pre-wrap"
          }}>
            {summary}
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
