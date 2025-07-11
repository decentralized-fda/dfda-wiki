import * as fs from 'fs';
import * as path from 'path';

interface MovedFile {
  originalPath: string;
  newPath: string;
  fileName: string;
}

async function updateReferences(movedFiles: MovedFile[], allFiles: string[]): Promise<void> {
  for (const movedFile of movedFiles) {
    const originalFileName = path.basename(movedFile.originalPath);
    
    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const updatedContent = content.replace(
        new RegExp(`\\[([^\\]]+)\\]\\(([^)]*${originalFileName})\\)`, 'g'),
        (match, linkText, oldPath) => {
          const newRelativePath = path.relative(
            path.dirname(filePath),
            movedFile.newPath
          ).split(path.sep).join('/');
          return `[${linkText}](${newRelativePath})`;
        }
      );

      if (updatedContent !== content) {
        fs.writeFileSync(filePath, updatedContent);
        console.log(`Updated references to ${originalFileName} in ${path.basename(filePath)}`);
      }
    }
  }
}

export { updateReferences }; 