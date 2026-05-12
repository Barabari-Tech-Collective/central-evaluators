import fs from 'fs';
import path from 'path';

export function findJavaScriptFiles(rootDir) {

  const students = [];

  function scan(dir) {

    const items = fs.readdirSync(dir);

    for (const item of items) {

      const fullPath = path.join(dir, item);

      if (fs.lstatSync(fullPath).isDirectory()) {

        const jsFiles = fs
          .readdirSync(fullPath)
          .filter(file => file.endsWith('.js'));

        if (jsFiles.length > 0) {

          students.push({
            name: item,
            filePath: path.join(fullPath, jsFiles[0])
          });

        } else {
          scan(fullPath);
        }
      }
    }
  }

  scan(rootDir);

  return students;
}