const fs = require('fs').promises;
const path = require('path');
const { shouldIgnore } = require('./shared-utilities');
const { analyzeFileLocation } = require('./file-path-analyzer');

async function getDirectoryTree(startPath) {
    const tree = [];
    
    async function buildTree(currentPath, relativePath = '') {
        try {
            const items = await fs.readdir(currentPath, { withFileTypes: true });
            
            for (const item of items) {
                if (shouldIgnore(item.name)) continue;
                
                const fullPath = path.join(currentPath, item.name);
                const relPath = path.join(relativePath, item.name);
                
                if (item.isDirectory()) {
                    tree.push(`📁 ${relPath}/`);
                    await buildTree(fullPath, relPath);
                } else {
                    tree.push(`📄 ${relPath}`);
                }
            }
        } catch (error) {
            console.error(`Error processing directory ${currentPath}:`, error);
            throw error;
        }
    }
    
    await buildTree(startPath);
    return tree.join('\n');
}

async function suggestFolderWithLLM(filePath, fileContent) {
    return analyzeFileLocation(filePath, fileContent, {
        maxContentLength: 500
    });
}

// Add proper exports
module.exports = {
    getDirectoryTree,
    suggestFolderWithLLM
}; 