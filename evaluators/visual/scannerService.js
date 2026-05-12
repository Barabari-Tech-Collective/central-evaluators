import fs from 'fs-extra';
import path from 'path';
import { globby } from 'globby';

export async function scanStudentFolders(rootDir) {

  const students = await fs.readdir(rootDir);

  let results = [];

  for (const student of students) {

    if (student.startsWith('.')) continue;

    const studentPath = path.join(rootDir, student);

    const stat = await fs.stat(studentPath);

    if (!stat.isDirectory()) continue;

    const htmlFiles = await globby(['**/*.html'], {
      cwd: studentPath,
      absolute: true
    });

    const cssFiles = await globby(['**/*.css'], {
      cwd: studentPath,
      absolute: true
    });

    const flags = [];

    if (htmlFiles.length === 0) {
      flags.push('Missing HTML');
    }

    if (cssFiles.length === 0) {
      flags.push('Missing CSS');
    }

    results.push({
      name: student,
      html: htmlFiles[0] || null,
      css: cssFiles,
      flags,
      basePath: studentPath
    });
  }

  return results;
}