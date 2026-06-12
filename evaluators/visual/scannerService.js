import { globby } from 'globby';

export async function scanStudentFolders(rootDir) {

  const htmlFiles = await globby(
    ['**/*.html'],
    {
      cwd: rootDir,
      absolute: true
    }
  );

  const cssFiles = await globby(
    ['**/*.css'],
    {
      cwd: rootDir,
      absolute: true
    }
  );

  const flags = [];

  if (htmlFiles.length === 0) {
    flags.push('Missing HTML');
  }

  if (cssFiles.length === 0) {
    flags.push('Missing CSS');
  }

  return {
    html: htmlFiles[0] || null,
    css: cssFiles,
    flags,
    basePath: rootDir
  };
}