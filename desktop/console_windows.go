package main

import (
	"os"
	"syscall"
	"unsafe"
)

func init() {
	const enableEchoInput = 0x0004
	kernel := syscall.NewLazyDLL("kernel32.dll")
	setMode := kernel.NewProc("SetConsoleMode")
	processList := kernel.NewProc("GetConsoleProcessList")
	disableInputEcho = func() func() {
		handle := syscall.Handle(os.Stdin.Fd())
		var mode uint32
		if err := syscall.GetConsoleMode(handle, &mode); err != nil {
			return func() {}
		}
		if ok, _, _ := setMode.Call(uintptr(handle), uintptr(mode &^ enableEchoInput)); ok == 0 {
			return func() {}
		}
		return func() {
			setMode.Call(uintptr(handle), uintptr(mode))
		}
	}
	ownsConsole = func() bool {
		var processID uint32
		count, _, _ := processList.Call(uintptr(unsafe.Pointer(&processID)), 1)
		return count == 1 && processID == uint32(os.Getpid())
	}
}
