package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

//go:embed all:web
var webFS embed.FS

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func main() {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		fmt.Println("ошибка файлов сайта:", err)
		waitExit()
		return
	}
	ln, err := net.Listen("tcp", "127.0.0.1:17880")
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			fmt.Println("не удалось открыть порт:", err)
			waitExit()
			return
		}
	}
	addr := "http://" + ln.Addr().String() + "/"
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	fmt.Println("Тест ОПП запущен")
	fmt.Println(addr)
	fmt.Println("Окно не закрывайте, пока идёт тест.")
	go func() {
		time.Sleep(400 * time.Millisecond)
		openBrowser(addr)
	}()
	if err := http.Serve(ln, mux); err != nil {
		fmt.Println(err)
		waitExit()
	}
}

func waitExit() {
	fmt.Println("Нажмите Enter, чтобы закрыть")
	buf := make([]byte, 1)
	_, _ = os.Stdin.Read(buf)
}
