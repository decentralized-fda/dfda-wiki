/**
 * Notion-Markdown Sync Script
 * 
 * This script syncs markdown files with a Notion database.
 * 
 * Setup Instructions:
 * 1. Get your Notion API key:
 *    - Go to https://www.notion.so/my-integrations
 *    - Click "New integration"
 *    - Give it a name (e.g. "Markdown Sync")
 *    - Copy the "Internal Integration Token"
 * 
 * 2. Get your Notion Database ID:
 *    - Open your Notion database in browser
 *    - The ID is in the URL: https://notion.so/{workspace}/{database_id}?v={view_id}
 *    - Copy the database_id part
 * 
 * 3. Share your database with the integration:
 *    - Open your database in Notion
 *    - Click "Share" in top right
 *    - Click "Add connections"
 *    - Select your integration
 * 
 * 4. Create a .env file with:
 *    NOTION_API_KEY=your_api_key_here
 *    NOTION_DATABASE_ID=your_database_id_here
 */

require('dotenv').config(); // Load environment variables from .env file

console.log("NOTION_DATABASE_ID:", process.env.NOTION_DATABASE_ID);

const { Client } = require("@notionhq/client");
const { UpdatePageParameters } = require("@notionhq/client/build/src/api-endpoints");
const fs = require("fs");
const path = require("path");
const { simpleGit } = require('simple-git');
const { promisify } = require("util");
const ignore = require('ignore');
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

interface MarkdownMetadata {
  title: string;
  description: string;
  published: boolean;
  date: string;
  tags: string;
  editor: string;
  dateCreated: string;
}

interface NotionBlock {
    object: string;
    type: string;
    [key: string]: any;
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
if(!databaseId) {
    throw new Error("NOTION_DATABASE_ID is not set");
}
const git = simpleGit();

// Required database properties
const REQUIRED_PROPERTIES = {
  title: { type: 'title', name: 'title' },
  description: { type: 'rich_text', name: 'description' },
  published: { type: 'checkbox', name: 'published' },
  date: { type: 'date', name: 'date' },
  tags: { type: 'rich_text', name: 'tags' },
  editor: { type: 'rich_text', name: 'editor' },
  dateCreated: { type: 'date', name: 'dateCreated' }
};

async function syncMarkdownFilesToNotion() {
    console.log("Starting syncMarkdownFilesToNotion");
    const markdownFiles = await getMarkdownFiles("./");
    console.log("Markdown files found:", markdownFiles);
    const lastModifiedDates = await getGitLastModifiedDates(markdownFiles);

    // 3.  Iterate through each markdown file
    for (const filePath of markdownFiles) {
        try{

            // 4.  Extract metadata and content
            const { metadata, content } = await extractMetadataAndContent(filePath);

            // 5.  Get corresponding Notion page (if it exists)
            const notionPage = await getNotionPageByTitle(metadata.title);

            // 6.  Compare last modified dates
            const fileLastModified = lastModifiedDates[filePath];

            if (notionPage) {
                // 7.  Notion Page exists
                const notionLastEditedTime = new Date(notionPage.last_edited_time);

                if (fileLastModified > notionLastEditedTime) {
                    // 8.  File is newer, update Notion page
                    console.log(`Updating Notion page for ${filePath}`);
                    await updateNotionPage(notionPage.id, metadata, content);
                } else if (fileLastModified < notionLastEditedTime) {
                    // 9.  Notion page is newer, update file
                    console.log(`Updating file ${filePath} from Notion`);
                    await updateMarkdownFile(filePath, notionPage);
                } else {
                    console.log(`File ${filePath} and Notion page are in sync`);
                }
            } else {
                // 10. Notion Page does not exist, create it
                console.log(`Creating Notion page for ${filePath}`);
                await createNotionPage(metadata, content);
            }
        } catch (error) {
            console.error(`Error processing ${filePath}:`, error);
        }
    }
}

// Helper Functions

// Get all markdown files
async function getMarkdownFiles(dir: string): Promise<string[]> {
    // Initialize ignore with .gitignore patterns
    const ig = ignore();
    try {
        const gitignoreContent = await readFile(path.join(dir, '.gitignore'), 'utf8');
        ig.add(gitignoreContent);
    } catch (error) {
        console.log('No .gitignore file found in', dir);
    }

    async function getFiles(currentDir: string): Promise<string[]> {
        const files = fs.readdirSync(currentDir, { withFileTypes: true });
        let markdownFiles: string[] = [];

        for (const file of files) {
            const fullPath = path.join(currentDir, file.name);
            // Get path relative to the current directory for gitignore checking
            const relativePath = path.relative(dir, fullPath);

            // Skip if path is ignored by .gitignore
            if (ig.ignores(relativePath)) {
                console.log('Ignoring file:', relativePath);
                continue;
            }

            if (file.isDirectory()) {
                markdownFiles = markdownFiles.concat(await getFiles(fullPath));
            } else if (file.name.endsWith(".md")) {
                markdownFiles.push(fullPath);
            }
        }

        return markdownFiles;
    }

    return getFiles(dir);
}

// Get last modified dates from Git
async function getGitLastModifiedDates(filePaths: string[]): Promise<{ [key: string]: Date }> {
  const lastModifiedDates: { [key: string]: Date } = {};

    // Loop through all files
  for (const filePath of filePaths) {
    try {
        // Get the last commit date
      const log = await git.log({ file: filePath, maxCount: 1 });
      if (log.latest) {
        lastModifiedDates[filePath] = new Date(log.latest.date);
      } else {
          // No commit found, use file stat
        lastModifiedDates[filePath] = new Date(fs.statSync(filePath).mtime);
      }
    } catch (error) {
      console.error(`Error getting Git log for ${filePath}:`, error);
      lastModifiedDates[filePath] = new Date(fs.statSync(filePath).mtime); // Fallback to file mtime
    }
  }
  return lastModifiedDates;
}

// Extract metadata and content from markdown file
async function extractMetadataAndContent(filePath: string): Promise<{ metadata: MarkdownMetadata; content: string }> {
  const fileContent = await readFile(filePath, "utf-8");
  // Normalize line endings and remove BOM if present
  const normalizedContent = fileContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  // Remove any duplicate frontmatter sections
  const cleanedContent = normalizedContent.replace(/^---\n[\s\S]*?\n---\n[\s\S]*?\n---\n/, '---\n');
  // Regex to match metadata
  const metadataRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = cleanedContent.match(metadataRegex);

  if (!match) {
    // If no frontmatter found, create default metadata from filename
    console.log(`No frontmatter found in ${filePath}, creating default metadata`);
    const fileName = path.basename(filePath, '.md');
    const title = fileName.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    
    return {
      metadata: {
        title,
        description: "",
        published: false,
        date: new Date().toISOString().split('T')[0],
        tags: "",
        editor: "",
        dateCreated: new Date().toISOString().split('T')[0]
      },
      content: cleanedContent.trim()
    };
  }

  // Parse metadata using YAML parser
  const yaml = require('js-yaml');
  try {
    const metadata = yaml.load(match[1]) as MarkdownMetadata;
    console.log('Raw YAML metadata:', match[1]);
    console.log('Parsed metadata:', metadata);
    
    // Ensure required fields exist with proper types
    const processedMetadata: MarkdownMetadata = {
      title: String(metadata.title || '').replace(/^['"]|['"]$/g, ''), // Remove quotes
      description: String(metadata.description || ''),
      published: Boolean(metadata.published),
      date: metadata.date ? new Date(metadata.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      tags: Array.isArray(metadata.tags) ? metadata.tags.join(',') : String(metadata.tags || ''),
      editor: String(metadata.editor || ''),
      dateCreated: metadata.dateCreated ? new Date(metadata.dateCreated).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    };

    // Get the content without frontmatter
    const content = match[2].trim();
    return { metadata: processedMetadata, content };
  } catch (error) {
    console.error(`Error parsing frontmatter for ${filePath}:`, error);
    throw error;
  }
}

// Get Notion page by title
async function getNotionPageByTitle(title: string): Promise<any | null> {
    try {
        const response = await notion.databases.query({
            database_id: databaseId as string,
            filter: {
                property: "title",
                rich_text: {
                    equals: title,
                },
            },
        });
        return response.results[0] || null;
    } catch (error) {
        console.error("Error in getNotionPageByTitle:", error);
        return null;
    }
}

// Convert markdown content to Notion blocks
function markdownToBlocks(markdown: string): any[] {
    const blocks: any[] = [];
    const lines = markdown.split('\n');
    let currentBlock: any = null;
    let tableHeaders: string[] = [];
    let tableRows: string[][] = [];

    function parseInlineMarkdown(text: string) {
        // Handle inline code
        text = text.replace(/`([^`]+)`/g, (_, code) => {
            return code;
        });

        // Handle bold
        text = text.replace(/\*\*(.+?)\*\*/g, (_, content) => {
            return content;
        });

        // Handle italic
        text = text.replace(/\*(.+?)\*/g, (_, content) => {
            return content;
        });

        // Handle links
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, title, url) => {
            return title;
        });

        return text;
    }

    function createRichText(text: string, annotations = {}) {
        return {
            type: "text",
            text: { content: text },
            annotations: {
                bold: text.match(/\*\*(.+?)\*\*/g) !== null,
                italic: text.match(/\*(.+?)\*/g) !== null,
                code: text.match(/`([^`]+)`/g) !== null,
                ...annotations
            }
        };
    }

    function flushTable() {
        if (tableHeaders.length > 0) {
            blocks.push({
                type: "table",
                table: {
                    table_width: tableHeaders.length,
                    has_column_header: true,
                    has_row_header: false,
                    children: [
                        {
                            type: "table_row",
                            table_row: {
                                cells: tableHeaders.map(header => [createRichText(header)])
                            }
                        },
                        ...tableRows.map(row => ({
                            type: "table_row",
                            table_row: {
                                cells: row.map(cell => [createRichText(cell)])
                            }
                        }))
                    ]
                }
            });
            tableHeaders = [];
            tableRows = [];
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Handle horizontal rules
        if (line.match(/^[\-\*_]{3,}$/)) {
            blocks.push({
                type: "divider",
                divider: {}
            });
            continue;
        }

        // Handle tables
        const tableRow = line.trim().match(/^\|(.+)\|$/);
        if (tableRow) {
            const cells = tableRow[1].split('|').map(cell => cell.trim());
            
            if (tableHeaders.length === 0) {
                tableHeaders = cells;
                // Skip the separator line
                i++;
            } else {
                tableRows.push(cells);
            }
            continue;
        }

        // Flush table if we're no longer in a table
        if (tableHeaders.length > 0 && !line.includes('|')) {
            flushTable();
        }

        // Handle headers
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const text = parseInlineMarkdown(headerMatch[2]);
            blocks.push({
                type: `heading_${level}`,
                [`heading_${level}`]: {
                    rich_text: [createRichText(text)]
                }
            });
            continue;
        }

        // Handle code blocks
        if (line.startsWith('```')) {
            if (!currentBlock) {
                currentBlock = {
                    type: "code",
                    code: {
                        language: line.slice(3).toLowerCase() || "plain text",
                        rich_text: [{ type: "text", text: { content: "" } }]
                    }
                };
            } else {
                blocks.push(currentBlock);
                currentBlock = null;
            }
            continue;
        }

        // Add content to code block
        if (currentBlock?.type === "code") {
            currentBlock.code.rich_text[0].text.content += line + "\n";
            continue;
        }

        // Handle images
        const imageMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
        if (imageMatch) {
            try {
                const url = imageMatch[2];
                console.log('Found image with URL:', url);
                // Only create image block if URL is valid
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    const imageBlock = {
                        object: "block",
                        type: "image",
                        has_children: false,
                        image: {
                            type: "external",
                            external: {
                                url: url
                            }
                        }
                    };
                    console.log('Created image block:', JSON.stringify(imageBlock, null, 2));
                    blocks.push(imageBlock);
                    continue;
                }
                console.log('Invalid URL, creating paragraph instead');
                blocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                        rich_text: [createRichText(line)]
                    }
                });
            } catch (error) {
                console.log('Error creating image block:', error);
                // If there's any error with the URL, create a paragraph instead
                blocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                        rich_text: [createRichText(line)]
                    }
                });
            }
            continue;
        }

        // Handle bullet points
        if (line.match(/^[\-\*]\s/)) {
            const text = parseInlineMarkdown(line.slice(2));
            blocks.push({
                type: "bulleted_list_item",
                bulleted_list_item: {
                    rich_text: [createRichText(text)]
                }
            });
            continue;
        }

        // Handle numbered lists
        const numberedListMatch = line.match(/^\d+\.\s+(.+)$/);
        if (numberedListMatch) {
            const text = parseInlineMarkdown(numberedListMatch[1]);
            blocks.push({
                type: "numbered_list_item",
                numbered_list_item: {
                    rich_text: [createRichText(text)]
                }
            });
            continue;
        }

        // Handle blockquotes
        if (line.startsWith('>')) {
            const text = parseInlineMarkdown(line.slice(1).trim());
            blocks.push({
                type: "quote",
                quote: {
                    rich_text: [createRichText(text)]
                }
            });
            continue;
        }

        // Handle regular paragraphs (including blank lines)
        if (line.trim() || blocks.length === 0 || blocks[blocks.length - 1].type !== "paragraph") {
            const text = parseInlineMarkdown(line);
            blocks.push({
                type: "paragraph",
                paragraph: {
                    rich_text: [createRichText(text)]
                }
            });
        }
    }

    // Flush any remaining table
    flushTable();

    // Ensure all blocks have a type field
    return blocks.map(block => {
        if (!block?.type) {
            // Default to paragraph if no type is set
            return {
                object: "block",
                type: "paragraph",
                paragraph: {
                    rich_text: [createRichText("")]
                }
            } as NotionBlock;
        }
        
        // Create a base block with all required properties
        const validBlock: NotionBlock = {
            object: "block",
            type: block.type,
            has_children: false
        };
        
        // Add the specific block content
        switch (block.type) {
            case 'paragraph':
            case 'quote':
            case 'bulleted_list_item':
            case 'numbered_list_item':
                validBlock[block.type] = {
                    rich_text: block[block.type]?.rich_text || [createRichText("")]
                };
                break;
            case 'heading_1':
            case 'heading_2':
            case 'heading_3':
                validBlock[block.type] = {
                    rich_text: block[block.type]?.rich_text || [createRichText("")]
                };
                break;
            case 'code':
                validBlock[block.type] = {
                    rich_text: block[block.type]?.rich_text || [createRichText("")],
                    language: block[block.type]?.language || "plain text"
                };
                break;
            case 'image':
                if (block.image?.type === 'external' && block.image?.external?.url) {
                    validBlock.image = block.image;
                    validBlock.type = 'image';
                    validBlock.object = 'block';
                    validBlock.has_children = false;
                    return validBlock;
                }
                // If image block is invalid, return null to filter it out
                return null;
            case 'divider':
                validBlock[block.type] = {};
                break;
            default:
                // Convert unknown block types to paragraph
                validBlock.type = "paragraph";
                validBlock.paragraph = {
                    rich_text: [createRichText("")]
                };
        }
        
        return validBlock;
    }).filter((block): block is NotionBlock => {
        // Filter out any blocks that don't have valid type and properties
        if (!block) {
            return false;
        }
        
        switch (block.type) {
            case 'divider':
                return true;
            case 'image':
                console.log('Validating image block:', JSON.stringify(block, null, 2));
                return block.type === 'image' && block.image?.type === 'external' && block.image?.external?.url;
            default:
                return block[block.type]?.rich_text && Array.isArray(block[block.type]?.rich_text);
        }
    });
}

// Helper function to ensure valid ISO 8601 date
function formatDate(dateStr: string): string {
    try {
        // Try to parse the date
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            // If invalid, return today's date
            return new Date().toISOString().split('T')[0];
        }
        // Return YYYY-MM-DD format
        return date.toISOString().split('T')[0];
    } catch {
        // On error, return today's date
        return new Date().toISOString().split('T')[0];
    }
}

// Create Notion page
async function createNotionPage(metadata: MarkdownMetadata, content: string) {
    try {
        if (!databaseId) throw new Error("Database ID is not set");
        
        // Create the page first
        const page = await notion.pages.create({
            parent: { database_id: databaseId },
            properties: {
                title: { title: [{ text: { content: metadata.title } }] },
                description: { rich_text: [{ text: { content: metadata.description } }] },
                published: { checkbox: metadata.published },
                date: { date: { start: formatDate(metadata.date) } },
                tags: { rich_text: [{ text: { content: metadata.tags } }] },
                editor: { rich_text: [{ text: { content: metadata.editor } }] },
                dateCreated: { date: { start: formatDate(metadata.dateCreated) } },
            },
            children: [] // Create page without content first
        });

        // Convert markdown to Notion blocks
        const blocks = markdownToBlocks(content);

        // Then add content in chunks of 100 blocks
        for (let i = 0; i < blocks.length; i += 100) {
            const chunk = blocks.slice(i, i + 100);
            await notion.blocks.children.append({
                block_id: page.id,
                children: chunk
            });
        }

        return page;
    } catch (error) {
        console.error("Error in createNotionPage:", error);
    }
}

// Update Notion page
async function updateNotionPage(pageId: string, metadata: MarkdownMetadata, content: string) {
    try {
        const updateData = {
            page_id: pageId,
            properties: {
                description: { rich_text: [{ text: { content: metadata.description } }] },
                published: { checkbox: metadata.published },
                date: { date: { start: formatDate(metadata.date) } },
                tags: { rich_text: [{ text: { content: metadata.tags } }] },
                editor: { rich_text: [{ text: { content: metadata.editor } }] },
                dateCreated: { date: { start: formatDate(metadata.dateCreated) } },
            }
        };
        await notion.pages.update(updateData);
        
        // First delete existing content
        const existingBlocks = await notion.blocks.children.list({ block_id: pageId });
        for (const block of existingBlocks.results) {
            await notion.blocks.delete({ block_id: block.id });
        }

        // Convert markdown to Notion blocks
        const blocks = markdownToBlocks(content);

        // Then add new content in chunks of 100 blocks
        for (let i = 0; i < blocks.length; i += 100) {
            const chunk = blocks.slice(i, i + 100);
            await notion.blocks.children.append({
                block_id: pageId,
                children: chunk
            });
        }
    } catch (error) {
        console.error("Error in updateNotionPage:", error);
    }
}

// Update markdown file from Notion page
async function updateMarkdownFile(filePath: string, notionPage: any) {
    // Get properties
    const props = notionPage.properties;
    const title = props.title.title[0]?.plain_text || "";
    const description = props.description.rich_text[0]?.plain_text || "";
    const published = props.published.checkbox;
    const date = props.date.date.start;
    const tags = props.tags.rich_text[0]?.plain_text || "";
    const editor = props.editor.rich_text[0]?.plain_text || "";
    const dateCreated = props.dateCreated.date.start;

    // Get content
    const blocks = await notion.blocks.children.list({ block_id: notionPage.id });
    let content = "";
    for (const block of blocks.results) {
        if ('type' in block && block.type === "paragraph" && 'paragraph' in block) {
            const paragraph = block.paragraph as { rich_text: Array<{ plain_text: string }> };
            content += paragraph.rich_text.map(rt => rt.plain_text).join("") + "\n";
        }
    }

    // Construct new file content
    const newFileContent = `---\n` +
        `title: ${title}\n` +
        `description: ${description}\n` +
        `published: ${published}\n` +
        `date: ${date}\n` +
        `tags: ${tags}\n` +
        `editor: ${editor}\n` +
        `dateCreated: ${dateCreated}\n` +
        `---\n\n` +
        content;

    // Write the file
    await writeFile(filePath, newFileContent);
}

// Ensure database has required properties
async function ensureDatabaseProperties() {
  try {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    const existingProps = database.properties;
    const updates: any = { properties: {} };
    let needsUpdate = false;

    // Check each required property
    for (const [key, config] of Object.entries(REQUIRED_PROPERTIES)) {
      if (!existingProps[key]) {
        needsUpdate = true;
        updates.properties[key] = {
          name: config.name,
          [config.type]: {}
        };
      }
    }

    // Update database if needed
    if (needsUpdate) {
      console.log('Adding missing properties to database...');
      await notion.databases.update({
        database_id: databaseId,
        ...updates
      });
      console.log('Database properties updated successfully');
    }
  } catch (error) {
    console.error('Error ensuring database properties:', error);
    throw error;
  }
}

// Only run sync if this is the main module
if (require.main === module) {
  ensureDatabaseProperties()
    .then(() => syncMarkdownFilesToNotion())
    .catch((error) => {
      console.error("Global error:", error);
    });
}

// Export functions for testing
module.exports = {
  getMarkdownFiles,
  extractMetadataAndContent,
  getNotionPageByTitle,
  updateNotionPage,
  createNotionPage,
  updateMarkdownFile,
  ensureDatabaseProperties,
  syncMarkdownFilesToNotion
};