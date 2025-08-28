import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Clock, Loader2, FolderOpen, Play, FileText, Brain } from "lucide-react";
import "./App.css";

interface ProcessStep {
  id: string;
  name: string;
  completed: boolean;
  inProgress: boolean;
  progress: number;
  output: string[];
}

function AppContent() {
  const [videoUrl, setVideoUrl] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiProvider, setApiProvider] = useState("openai");
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [processSteps, setProcessSteps] = useState<ProcessStep[]>([
    { id: "download", name: "下载视频", completed: false, inProgress: false, progress: 0, output: [] },
    { id: "transcribe", name: "语音转录", completed: false, inProgress: false, progress: 0, output: [] },
    { id: "summarize", name: "AI总结", completed: false, inProgress: false, progress: 0, output: [] }
  ]);

  useEffect(() => {
    // 设置默认下载路径为 ~/Downloads
    const defaultPath = "~/Downloads";
    setDownloadPath(defaultPath);
  }, []);

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

  const updateStepProgress = (stepId: string, progress: number, output?: string, completed?: boolean) => {
    setProcessSteps(prev => prev.map(step => {
      if (step.id === stepId) {
        const newOutput = output ? [...step.output, `[${new Date().toLocaleTimeString()}] ${output}`] : step.output;
        return {
          ...step,
          progress,
          inProgress: !completed && progress < 100,
          completed: completed || progress === 100,
          output: newOutput
        };
      }
      return step;
    }));
  };

  const resetSteps = () => {
    setProcessSteps(prev => prev.map(step => ({
      ...step,
      completed: false,
      inProgress: false,
      progress: 0,
      output: []
    })));
  };

  async function processVideo() {
    if (!videoUrl.trim()) return;
    
    setIsProcessing(true);
    setStatus("开始处理...");
    setTranscript("");
    setSummary("");
    resetSteps();

    try {
      // 开始下载步骤
      updateStepProgress("download", 10, "开始下载视频...");
      setStatus("正在下载视频...");
      
      const result = await invoke("process_video_pipeline", {
        url: videoUrl,
        basePath: downloadPath || null,
        apiKey: apiKey || null,
        apiProvider: apiProvider === "openai" ? null : apiProvider
      });
      
      // 解析返回的结果
      const videoRecord = JSON.parse(result as string);
      
      // 模拟步骤完成（由于后端是一次性返回，我们需要模拟进度）
      updateStepProgress("download", 100, "视频下载完成", true);
      updateStepProgress("transcribe", 100, "语音转录完成", true);
      updateStepProgress("summarize", 100, "AI总结完成", true);
      
      // 更新UI状态
      if (videoRecord.transcript_content) {
        setTranscript(videoRecord.transcript_content);
      }
      
      if (videoRecord.summary_content) {
        setSummary(videoRecord.summary_content);
      }
      
      // 显示最终状态
      const title = videoRecord.title || "未知标题";
      setStatus(`✅ 全部完成! 视频: "${title}" (ID: ${videoRecord.id})`);
      
    } catch (error) {
      const errorMessage = `❌ 错误: ${error}`;
      setStatus(errorMessage);
      
      // 找到当前进行中的步骤并标记为失败
      setProcessSteps(prev => prev.map(step => {
        if (step.inProgress) {
          return {
            ...step,
            inProgress: false,
            output: [...step.output, `[${new Date().toLocaleTimeString()}] 错误: ${error}`]
          };
        }
        return step;
      }));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4 dark:bg-slate-950 transition-colors">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2 dark:text-slate-100 bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">视频转录助手</h1>
            <p className="text-lg text-muted-foreground dark:text-slate-400">输入YouTube或其他视频链接，自动转录并生成总结</p>
          </div>
          <ThemeToggle />
        </div>

        <Card className="mb-6 dark:bg-slate-900 dark:border-slate-700 shadow-lg dark:shadow-2xl">
          <CardHeader>
            <CardTitle className="dark:text-slate-100">配置选项</CardTitle>
            <CardDescription className="dark:text-slate-400">设置视频下载路径和API密钥</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="download-path" className="dark:text-slate-200">下载路径</Label>
              <div className="flex gap-3 items-center">
                <Input
                  id="download-path"
                  value={downloadPath}
                  placeholder="选择视频和音频文件的保存位置"
                  readOnly
                  disabled={isProcessing}
                  className="flex-1 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:placeholder:text-slate-500"
                />
                <Button 
                  onClick={selectDownloadPath}
                  disabled={isProcessing}
                  variant="outline"
                  size="default"
                  className="dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  选择路径
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="video-url" className="dark:text-slate-200">视频URL</Label>
              <Input
                id="video-url"
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="请输入视频URL (例如: https://www.youtube.com/watch?v=...)"
                disabled={isProcessing}
                className="dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-provider" className="dark:text-slate-200">AI服务提供商</Label>
              <Select
                id="api-provider"
                value={apiProvider}
                onChange={(e) => setApiProvider(e.target.value)}
                disabled={isProcessing}
                className="dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200"
              >
                <option value="openai">OpenAI (GPT-3.5)</option>
                <option value="deepseek">DeepSeek</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key" className="dark:text-slate-200">
                {apiProvider === "deepseek" ? "DeepSeek" : "OpenAI"} API Key (可选)
              </Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`输入${apiProvider === "deepseek" ? "DeepSeek" : "OpenAI"} API密钥获得更好的AI总结，留空使用简单总结`}
                disabled={isProcessing}
                className="dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:placeholder:text-slate-500"
              />
              <p className="text-xs text-muted-foreground dark:text-slate-500">
                💡 API密钥仅用于本次会话，不会被保存 | 
                {apiProvider === "deepseek" ? " DeepSeek API相对更便宜" : " 支持多种模型"}
              </p>
            </div>
            
            <div className="flex justify-center pt-4">
              <Button 
                onClick={processVideo}
                disabled={isProcessing || !videoUrl.trim()}
                size="lg"
                className="px-8 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 dark:from-blue-500 dark:to-purple-500 dark:hover:from-blue-600 dark:hover:to-purple-600 shadow-lg hover:shadow-xl transition-all duration-300"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    开始转录
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {status && (
          <Card className="mb-6 dark:bg-slate-900 dark:border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-3 h-3 bg-primary dark:bg-blue-500 rounded-full animate-pulse mt-1"></div>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-xs font-medium whitespace-pre-wrap leading-relaxed dark:text-slate-200">
                    <span className="font-bold dark:text-slate-100">状态：</span>{status}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isProcessing && (
          <Card className="mb-6 dark:bg-slate-900 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center dark:text-slate-100">
                <Loader2 className="w-5 h-5 mr-2 animate-spin text-blue-500" />
                处理进度
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {processSteps.map((step) => {
                const stepIcons = {
                  download: Play,
                  transcribe: FileText,
                  summarize: Brain
                };
                const StepIcon = stepIcons[step.id as keyof typeof stepIcons] || Play;
                
                return (
                  <div key={step.id} className="border rounded-lg p-4 bg-card dark:bg-slate-800 dark:border-slate-600">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
                          step.completed 
                            ? 'bg-green-500 text-white dark:bg-green-600' 
                            : step.inProgress 
                            ? 'bg-primary text-primary-foreground dark:bg-blue-500 dark:text-white animate-pulse' 
                            : 'bg-muted text-muted-foreground dark:bg-slate-700 dark:text-slate-400'
                        }`}>
                          {step.completed ? (
                            <CheckCircle className="w-4 h-4" />
                          ) : step.inProgress ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Clock className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex items-center">
                          <StepIcon className="w-4 h-4 mr-2 text-muted-foreground dark:text-slate-400" />
                          <h4 className="font-semibold dark:text-slate-200">{step.name}</h4>
                        </div>
                      </div>
                      <span className={`text-sm font-medium ${
                        step.completed 
                          ? 'text-green-600 dark:text-green-400' 
                          : step.inProgress 
                          ? 'text-primary dark:text-blue-400' 
                          : 'text-muted-foreground dark:text-slate-500'
                      }`}>
                        {step.completed ? '✅ 完成' : step.inProgress ? '🔄 进行中' : '⏳ 等待中'}
                      </span>
                    </div>
                    
                    <div className="mb-3">
                      <div className="flex justify-between text-sm text-muted-foreground dark:text-slate-400 mb-2">
                        <span>进度</span>
                        <span>{step.progress}%</span>
                      </div>
                      <Progress value={step.progress} className="w-full dark:bg-slate-700" />
                    </div>

                    {step.output.length > 0 && (
                      <div>
                        <h5 className="text-sm font-medium mb-2 dark:text-slate-200">输出日志：</h5>
                        <div className="bg-slate-950 dark:bg-black text-green-400 dark:text-green-300 text-xs font-mono p-3 rounded-lg max-h-32 overflow-y-auto border dark:border-slate-800">
                          {step.output.map((line, lineIndex) => (
                            <div key={lineIndex} className="mb-1">
                              {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {transcript && (
          <Card className="mb-6 dark:bg-slate-900 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center dark:text-slate-100">
                <FileText className="w-5 h-5 mr-2 text-blue-500" />
                转录文本
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/50 dark:bg-slate-800 p-6 rounded-lg max-h-80 overflow-auto border dark:border-slate-600">
                <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed dark:text-slate-200">
                  {transcript}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}

        {summary && (
          <Card className="dark:bg-slate-900 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center dark:text-slate-100">
                <Brain className="w-5 h-5 mr-2 text-purple-500" />
                AI总结
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-gradient-to-br from-primary/5 to-purple-500/5 dark:from-purple-900/20 dark:to-blue-900/20 p-6 rounded-lg border dark:border-slate-600 dark:bg-slate-800/50">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed dark:text-slate-200">
                  {summary}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider storageKey="video-transcriber-theme">
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
