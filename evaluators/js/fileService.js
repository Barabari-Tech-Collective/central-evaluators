import fs from 'fs';
import path from 'path';

export function findJavaScriptFile(rootDir) {

  function scan(dir) {

    const items = fs.readdirSync(dir);

    for (const item of items) {

      const fullPath = path.join(dir, item);

      if (fs.statSync(fullPath).isDirectory()) {

        const result = scan(fullPath);

        if (result) {
          return result;
        }

      } else if (item.endsWith('.js')) {

        console.log(
          `[FILE SERVICE] Found JS file: ${fullPath}`
        );

        return fullPath;
      }
    }

    return null;
  }

  return scan(rootDir);
}