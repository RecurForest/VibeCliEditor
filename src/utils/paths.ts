export function resolveProjectRelativePath(projectRoot: string, targetPath: string) {
  const normalizedProjectRoot = stripTrailingPathSeparators(projectRoot);
  const normalizedTargetPath = stripTrailingPathSeparators(targetPath);
  const comparableProjectRoot = normalizedProjectRoot.toLowerCase();
  const comparableTargetPath = normalizedTargetPath.toLowerCase();

  if (comparableTargetPath === comparableProjectRoot) {
    return ".";
  }

  if (
    comparableTargetPath.startsWith(`${comparableProjectRoot}\\`) ||
    comparableTargetPath.startsWith(`${comparableProjectRoot}/`)
  ) {
    return normalizedTargetPath.slice(normalizedProjectRoot.length + 1);
  }

  return normalizedTargetPath;
}

export function stripTrailingPathSeparators(path: string) {
  const strippedPath = path.replace(/[/\\]+$/, "");
  if (!strippedPath) {
    return path;
  }

  if (/^[A-Za-z]:$/u.test(strippedPath)) {
    return `${strippedPath}\\`;
  }

  return strippedPath;
}
