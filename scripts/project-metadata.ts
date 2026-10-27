import { posix, win32 } from "node:path";

// The folder name is a display hint, never a session identity or full path.
export function projectMetadata(cwd: unknown): { projectName?: string } {
  if (typeof cwd !== "string" || cwd.length > 4096) return {};
  const path = posix.isAbsolute(cwd)
    ? posix
    : win32.isAbsolute(cwd)
      ? win32
      : undefined;
  const projectName = path?.basename(cwd).trim();
  return projectName &&
    projectName.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(projectName)
    ? { projectName }
    : {};
}
