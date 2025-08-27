import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark")
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      className={`relative overflow-hidden border-2 transition-all duration-300 hover:scale-105 hover:shadow-lg ${
        theme === "light" 
          ? "border-orange-200 bg-orange-50 hover:bg-orange-100 hover:border-orange-300" 
          : "border-slate-700 bg-slate-900 hover:bg-black hover:border-slate-600"
      }`}
    >
      {theme === "light" ? (
        <Sun className="h-[1.2rem] w-[1.2rem] text-orange-500 transition-all duration-300 hover:text-orange-600 hover:rotate-12" />
      ) : (
        <Moon className="h-[1.2rem] w-[1.2rem] text-blue-400 transition-all duration-300 hover:text-blue-300 hover:rotate-12" />
      )}
      <span className="sr-only">切换主题</span>
    </Button>
  )
}