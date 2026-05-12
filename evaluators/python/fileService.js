// src/evaluators/python/services/fileService.js

import fs from "fs";
import path from "path";

export function findPythonFiles(rootDir) {

  const students = [];

  const folders = fs.readdirSync(rootDir);

  for (const folder of folders) {

    const studentPath = path.join(rootDir, folder);

    if (!fs.lstatSync(studentPath).isDirectory()) {
      continue;
    }

    const files = fs.readdirSync(studentPath);

    const pyFiles = files.filter(
      file => file.endsWith(".py")
    );

    if (pyFiles.length === 0) {
      continue;
    }

    const filePath = path.join(
      studentPath,
      pyFiles[0]
    );

    students.push({
      name: folder,
      filePath
    });
  }

  return students;
}