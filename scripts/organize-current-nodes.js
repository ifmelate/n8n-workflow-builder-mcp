#!/usr/bin/env node

/**
 * Organize Current N8N Nodes Script
 * 
 * This script helps organize your existing nodes in workflow_nodes/1.91.3/
 * into categories (triggers, actions, utilities, langchain) if desired.
 */

const fs = require('fs').promises;
const path = require('path');

const CURRENT_VERSION = '1.91.2';
const BASE_DIR = path.resolve(__dirname, '../workflow_nodes', CURRENT_VERSION);
const CATEGORIES_DIR = path.join(BASE_DIR, 'categorized');

// Node categorization rules
const CATEGORIZATION_RULES = {
    triggers: {
        patterns: [/trigger/i, /webhook/i, /cron/i, /schedule/i],
        filenames: ['manualTrigger', 'webhookTrigger', 'scheduleTrigger', 'cron']
    },
    langchain: {
        patterns: [/^langchain_/i, /@n8n\/n8n-nodes-langchain/],
        filenames: []
    },
    utilities: {
        patterns: [/merge/i, /filter/i, /set/i, /function/i, /wait/i, /switch/i, /if/i],
        filenames: ['merge', 'filter', 'set', 'function', 'wait', 'switch', 'if', 'dateTime', 'code']
    },
    actions: {
        patterns: [], // Default category for everything else
        filenames: []
    }
};

async function analyzeCurrentStructure() {
    console.log('🔍 Analyzing current node structure...\n');

    try {
        const files = await fs.readdir(BASE_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        console.log(`Found ${jsonFiles.length} node files in ${CURRENT_VERSION}\n`);

        const categorized = {
            triggers: [],
            langchain: [],
            utilities: [],
            actions: []
        };

        const analysis = [];

        for (const file of jsonFiles) {
            try {
                const filePath = path.join(BASE_DIR, file);
                const content = await fs.readFile(filePath, 'utf8');
                const nodeDefinition = JSON.parse(content);

                const category = categorizeNode(file, nodeDefinition);
                categorized[category].push(file);

                analysis.push({
                    file,
                    category,
                    nodeType: nodeDefinition.nodeType || 'unknown',
                    displayName: nodeDefinition.displayName || 'unknown'
                });

            } catch (error) {
                console.warn(`⚠️  Could not analyze ${file}: ${error.message}`);
            }
        }

        return { categorized, analysis };

    } catch (error) {
        console.error('❌ Error analyzing structure:', error);
        throw error;
    }
}

function categorizeNode(filename, nodeDefinition) {
    const baseName = filename.replace('.json', '');
    const nodeType = nodeDefinition.nodeType || '';
    const displayName = nodeDefinition.displayName || '';

    // Check each category
    for (const [category, rules] of Object.entries(CATEGORIZATION_RULES)) {
        // Skip actions (default category)
        if (category === 'actions') continue;

        // Check filename patterns
        if (rules.filenames.some(name => baseName.toLowerCase().includes(name.toLowerCase()))) {
            return category;
        }

        // Check regex patterns
        if (rules.patterns.some(pattern =>
            pattern.test(filename) ||
            pattern.test(nodeType) ||
            pattern.test(displayName)
        )) {
            return category;
        }
    }

    return 'actions'; // Default category
}

function printAnalysis(analysis) {
    const categorized = analysis.categorized;

    console.log('📊 CATEGORIZATION ANALYSIS');
    console.log('===========================\n');

    for (const [category, files] of Object.entries(categorized)) {
        console.log(`📁 ${category.toUpperCase()}: ${files.length} files`);
        if (files.length > 0) {
            // Show first few examples
            const examples = files.slice(0, 3);
            examples.forEach(file => {
                const nodeInfo = analysis.analysis.find(a => a.file === file);
                console.log(`   • ${file} (${nodeInfo?.displayName || 'unknown'})`);
            });
            if (files.length > 3) {
                console.log(`   ... and ${files.length - 3} more`);
            }
        }
        console.log();
    }
}

async function createCategorizedStructure(analysis, dryRun = true) {
    const action = dryRun ? 'WOULD CREATE' : 'CREATING';
    console.log(`${dryRun ? '🏗️  DRY RUN:' : '🚀 EXECUTING:'} ${action} categorized structure...\n`);

    if (!dryRun) {
        // Create category directories
        for (const category of Object.keys(CATEGORIZATION_RULES)) {
            const categoryDir = path.join(CATEGORIES_DIR, category);
            await fs.mkdir(categoryDir, { recursive: true });
        }
    }

    let moved = 0;

    for (const [category, files] of Object.entries(analysis.categorized)) {
        console.log(`${action} ${category} directory with ${files.length} files:`);

        for (const file of files) {
            const sourcePath = path.join(BASE_DIR, file);
            const targetPath = path.join(CATEGORIES_DIR, category, file);

            if (dryRun) {
                console.log(`  WOULD COPY: ${file} → categorized/${category}/${file}`);
            } else {
                try {
                    await fs.copyFile(sourcePath, targetPath);
                    console.log(`  COPIED: ${file} → categorized/${category}/${file}`);
                    moved++;
                } catch (error) {
                    console.error(`  ERROR: Failed to copy ${file}: ${error.message}`);
                }
            }
        }
        console.log();
    }

    if (!dryRun) {
        console.log(`✅ Successfully organized ${moved} files into categories`);
        console.log(`📁 New structure available at: ${CATEGORIES_DIR}`);
    }
}

async function main() {
    console.log('🎯 N8N Node Organization Tool\n');
    console.log(`Working with: workflow_nodes/${CURRENT_VERSION}/\n`);

    try {
        // Check if directory exists
        try {
            await fs.access(BASE_DIR);
        } catch (error) {
            console.error(`❌ Directory not found: ${BASE_DIR}`);
            console.log('Make sure you have nodes in workflow_nodes/1.91.3/');
            process.exit(1);
        }

        // Analyze structure
        const analysis = await analyzeCurrentStructure();

        // Print analysis
        printAnalysis(analysis);

        // Check command line arguments
        const args = process.argv.slice(2);
        const execute = args.includes('--execute');
        const dryRun = !execute;

        if (dryRun) {
            console.log('💡 This is a DRY RUN. Use --execute to create the categorized structure.\n');
        }

        // Create categorized structure
        await createCategorizedStructure(analysis, dryRun);

        if (dryRun) {
            console.log('🎯 Next Steps:');
            console.log('1. Review the categorization above');
            console.log('2. Run with --execute to create the categorized structure');
            console.log('3. Update your MCP server configuration if needed');
            console.log('4. You can keep both flat and categorized structures');
        } else {
            console.log('🎯 What you can do now:');
            console.log('1. Use the categorized structure for easier browsing');
            console.log('2. Update MCP server to load from categorized directories');
            console.log('3. Keep the flat structure as backup');
        }

    } catch (error) {
        console.error('❌ Organization failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
} 