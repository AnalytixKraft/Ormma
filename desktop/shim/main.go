// Command Ormma is the desktop app's front door: the program the Dock, the
// Start menu and the sign-in items run. It finds the Node bundled beside it
// and hands over to desktop/launcher.mjs, which does everything else — so
// this stays small enough to read at a glance. desktop/build.mjs lays the
// files out like this:
//
//	Mac      Ormma.app/Contents/MacOS/Ormma                   this
//	         Ormma.app/Contents/MacOS/ormma-node              Node
//	         Ormma.app/Contents/Resources/desktop/launcher.mjs
//
//	Windows  Ormma\Ormma.exe                                   this
//	         Ormma\node\ormma-node.exe                         Node
//	         Ormma\desktop\launcher.mjs
//
// It passes its own path on as ORMMA_SHIM, so the launcher can have the
// computer start Ormma — by this program's name — when you sign in.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

func main() {
	self, err := os.Executable()
	if err == nil {
		self, err = filepath.EvalSymlinks(self)
	}
	if err != nil {
		fail(err)
	}
	dir := filepath.Dir(self)
	node := filepath.Join(dir, "ormma-node")
	launcher := filepath.Join(dir, "..", "Resources", "desktop", "launcher.mjs")
	if runtime.GOOS == "windows" {
		node = filepath.Join(dir, "node", "ormma-node.exe")
		launcher = filepath.Join(dir, "desktop", "launcher.mjs")
	}
	args := append([]string{"--disable-warning=ExperimentalWarning", launcher}, os.Args[1:]...)
	env := append(os.Environ(), "ORMMA_SHIM="+self)
	if err := run(node, args, env); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "Ormma could not start:", err)
	os.Exit(1)
}
