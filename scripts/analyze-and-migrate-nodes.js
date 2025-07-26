#!/usr/bin/env node

/**
 * N8N Workflow Nodes Migration Analyzer and Script
 * 
 * This script analyzes the current workflow_nodes directory and:
 * 1. Categorizes nodes by type (basic, langchain, ai)
 * 2. Suggests appropriate N8N version placement
 * 3. Creates a migration plan
 * 4. Optionally executes the migration
 */

const fs = require('fs').promises;
const path = require('path');

// Configuration
const CURRENT_NODES_DIR = path.resolve(__dirname, '../workflow_nodes');
const NEW_STRUCTURE_DIR = path.resolve(__dirname, '../workflow_nodes_versioned');

// N8N Version mapping based on node introduction timeline
const N8N_VERSION_MAPPING = {
    "1.0.0": {
        name: "N8N Core",
        capabilities: ["basic_nodes", "webhook_triggers", "core_actions"],
        nodePatterns: [
            /^n8n-nodes-base\.(cron|webhook|httpRequest|gmail|slack)/,
            /^n8n-nodes-base\.(merge|filter|set|function)/,
            /^n8n-nodes-base\.(scheduleTrigger|manualTrigger)/
        ]
    },
    "1.10.0": {
        name: "N8N + LangChain Basic", 
        capabilities: ["all_1.0.0", "langchain_basic"],
        nodePatterns: [
            /^@n8n\/n8n-nodes-langchain\.(chainLlm|systemPromptTemplate)/,
            /^@n8n\/n8n-nodes-langchain\.(toolCode|outputParser)/
        ]
    },
    "1.20.0": {
        name: "N8N + AI Capabilities",
        capabilities: ["all_1.10.0", "ai_agents", "advanced_llm"],
        nodePatterns: [
            /^@n8n\/n8n-nodes-langchain\.(agent|lmChat)/,
            /^@n8n\/n8n-nodes-langchain\..*[Aa]gent/,
            /^@n8n\/n8n-nodes-langchain\..*[Ll]lm/
        ]
    },
    "1.30.0": {
        name: "N8N Advanced AI",
        capabilities: ["all_1.20.0", "multimodal_ai", "advanced_reasoning"],
        nodePatterns: [
            /^@n8n\/n8n-nodes-langchain\.(informationExtractor|sentimentAnalysis)/,
            /^@n8n\/n8n-nodes-langchain\.(textClassifier|.*[Mm]emory)/
        ]
    }
};

// Node categorization rules
const NODE_CATEGORIES = {
    triggers: ['trigger', 'Trigger'],
    actions: ['Action', 'Request', 'Send', 'Create', 'Update', 'Delete'],
    utilities: ['merge', 'filter', 'set', 'function', 'wait', 'switch'],
    langchain: ['langchain'],
    ai: ['ai', 'Agent', 'Llm', 'Chat', 'Analysis']
};

async function analyzeCurrentNodes() {
    console.log('🔍 Analyzing current workflow_nodes directory...\n');
    
    const analysisResults = {
        totalNodes: 0,
        nodesByType: {},
        nodesByVersion: {},
        migrationPlan: {},
        issues: []
    };
    
    try {
        const files = await fs.readdir(CURRENT_NODES_DIR);
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        
        console.log(`Found ${jsonFiles.length} node definition files\n`);
        
        for (const file of jsonFiles) {
            try {
                const filePath = path.join(CURRENT_NODES_DIR, file);
                const content = await fs.readFile(filePath, 'utf8');
                const nodeDefinition = JSON.parse(content);
                
                if (!nodeDefinition.nodeType || !nodeDefinition.displayName) {
                    analysisResults.issues.push(`${file}: Missing nodeType or displayName`);
                    continue;
                }
                
                analysisResults.totalNodes++;
                
                // Analyze node type and categorize
                const analysis = analyzeNode(nodeDefinition, file);
                
                // Store by type
                if (!analysisResults.nodesByType[analysis.category]) {
                    analysisResults.nodesByType[analysis.category] = [];
                }
                analysisResults.nodesByType[analysis.category].push(analysis);
                
                // Store by suggested N8N version
                if (!analysisResults.nodesByVersion[analysis.suggestedN8nVersion]) {
                    analysisResults.nodesByVersion[analysis.suggestedN8nVersion] = [];
                }
                analysisResults.nodesByVersion[analysis.suggestedN8nVersion].push(analysis);
                
                // Add to migration plan
                const targetPath = `versions/${analysis.suggestedN8nVersion}/${analysis.category}/${file}`;
                analysisResults.migrationPlan[file] = {
                    from: file,
                    to: targetPath,
                    category: analysis.category,
                    n8nVersion: analysis.suggestedN8nVersion,
                    nodeType: nodeDefinition.nodeType,
                    reason: analysis.reason
                };
                
            } catch (error) {
                analysisResults.issues.push(`${file}: Error parsing - ${error.message}`);
            }
        }
        
        return analysisResults;
        
    } catch (error) {
        console.error('Error analyzing nodes:', error);
        throw error;
    }
}

function analyzeNode(nodeDefinition, filename) {
    const nodeType = nodeDefinition.nodeType;
    const displayName = nodeDefinition.displayName;
    const version = nodeDefinition.version;
    
    // Determine category
    let category = 'utilities'; // default
    let reason = 'Default categorization';
    
    // Check for LangChain nodes
    if (nodeType.includes('@n8n/n8n-nodes-langchain')) {
        category = 'langchain';
        reason = 'LangChain node detected';
    }
    // Check for trigger nodes
    else if (filename.toLowerCase().includes('trigger') || displayName.toLowerCase().includes('trigger')) {
        category = 'triggers';
        reason = 'Trigger node detected';
    }
    // Check for utility nodes
    else if (NODE_CATEGORIES.utilities.some(util => 
        nodeType.toLowerCase().includes(util) || displayName.toLowerCase().includes(util)
    )) {
        category = 'utilities';
        reason = 'Utility node detected';
    }
    // Default to actions
    else {
        category = 'actions';
        reason = 'Classified as action node';
    }
    
    // Determine suggested N8N version
    let suggestedN8nVersion = '1.0.0'; // default
    let versionReason = 'Default basic node';
    
    // Check against version patterns
    for (const [version, versionInfo] of Object.entries(N8N_VERSION_MAPPING)) {
        for (const pattern of versionInfo.nodePatterns) {
            if (pattern.test(nodeType)) {
                suggestedN8nVersion = version;
                versionReason = `Matches ${versionInfo.name} pattern`;
                break;
            }
        }
        if (suggestedN8nVersion !== '1.0.0') break;
    }
    
    // Special cases for AI nodes
    if (nodeType.toLowerCase().includes('ai') || 
        displayName.toLowerCase().includes('ai') ||
        nodeType.toLowerCase().includes('openai')) {
        if (suggestedN8nVersion < '1.20.0') {
            suggestedN8nVersion = '1.20.0';
            versionReason = 'AI node requires N8N 1.20.0+';
        }
    }
    
    return {
        filename,
        nodeType,
        displayName,
        version,
        category,
        suggestedN8nVersion,
        reason: `${reason}; ${versionReason}`
    };
}

function printAnalysisReport(results) {
    console.log('📊 ANALYSIS REPORT');
    console.log('==================\n');
    
    console.log(`Total Nodes Analyzed: ${results.totalNodes}\n`);
    
    // Nodes by category
    console.log('📁 Nodes by Category:');
    for (const [category, nodes] of Object.entries(results.nodesByType)) {
        console.log(`  ${category}: ${nodes.length} nodes`);
    }
    console.log();
    
    // Nodes by N8N version
    console.log('🔄 Nodes by Suggested N8N Version:');
    for (const [version, nodes] of Object.entries(results.nodesByVersion)) {
        const versionInfo = N8N_VERSION_MAPPING[version];
        console.log(`  ${version} (${versionInfo?.name || 'Unknown'}): ${nodes.length} nodes`);
    }
    console.log();
    
    // Issues
    if (results.issues.length > 0) {
        console.log('⚠️  Issues Found:');
        results.issues.forEach(issue => console.log(`  • ${issue}`));
        console.log();
    }
    
    // Sample migration plan
    console.log('📋 Sample Migration Plan (first 10 files):');
    const sampleEntries = Object.entries(results.migrationPlan).slice(0, 10);
    for (const [file, plan] of sampleEntries) {
        console.log(`  ${file} → ${plan.to}`);
        console.log(`    Reason: ${plan.reason}`);
    }
    if (Object.keys(results.migrationPlan).length > 10) {
        console.log(`  ... and ${Object.keys(results.migrationPlan).length - 10} more files`);
    }
    console.log();
}

async function createMigrationStructure(results, dryRun = true) {
    console.log(`${dryRun ? '🏗️  DRY RUN:' : '🚀 EXECUTING:'} Creating new directory structure...\n`);
    
    if (!dryRun) {
        // Create base directory
        await fs.mkdir(NEW_STRUCTURE_DIR, { recursive: true });
        
        // Create version directories
        for (const version of Object.keys(N8N_VERSION_MAPPING)) {
            for (const category of ['triggers', 'actions', 'utilities', 'langchain', 'ai']) {
                const categoryDir = path.join(NEW_STRUCTURE_DIR, 'versions', version, category);
                await fs.mkdir(categoryDir, { recursive: true });
            }
        }
    }
    
    // Execute migration plan
    let successCount = 0;
    let errorCount = 0;
    
    for (const [file, plan] of Object.entries(results.migrationPlan)) {
        try {
            const sourcePath = path.join(CURRENT_NODES_DIR, file);
            const targetPath = path.join(NEW_STRUCTURE_DIR, plan.to);
            
            if (dryRun) {
                console.log(`WOULD COPY: ${file} → ${plan.to}`);
            } else {
                // Ensure target directory exists
                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                
                // Copy file
                await fs.copyFile(sourcePath, targetPath);
                console.log(`COPIED: ${file} → ${plan.to}`);
            }
            
            successCount++;
        } catch (error) {
            console.error(`ERROR copying ${file}: ${error.message}`);
            errorCount++;
        }
    }
    
    console.log(`\n✅ Migration ${dryRun ? 'plan' : 'completed'}:`);
    console.log(`  Success: ${successCount} files`);
    console.log(`  Errors: ${errorCount} files`);
    
    if (!dryRun) {
        // Create compatibility.json
        await createCompatibilityFile(results);
        console.log(`\n📄 Created compatibility.json`);
    }
}

async function createCompatibilityFile(results) {
    const compatibility = {
        versions: {},
        nodeEvolution: {},
        generatedAt: new Date().toISOString(),
        totalNodes: results.totalNodes,
        nodesByVersion: {}
    };
    
    // Add version info
    for (const [version, versionInfo] of Object.entries(N8N_VERSION_MAPPING)) {
        const nodesInVersion = results.nodesByVersion[version] || [];
        compatibility.versions[version] = {
            ...versionInfo,
            nodeCount: nodesInVersion.length,
            releaseDate: new Date().toISOString().split('T')[0] // placeholder
        };
        
        compatibility.nodesByVersion[version] = nodesInVersion.map(node => ({
            nodeType: node.nodeType,
            category: node.category,
            filename: node.filename
        }));
    }
    
    const compatibilityPath = path.join(NEW_STRUCTURE_DIR, 'compatibility.json');
    await fs.writeFile(compatibilityPath, JSON.stringify(compatibility, null, 2));
}

async function main() {
    console.log('🎯 N8N Workflow Nodes Migration Tool\n');
    
    try {
        // Check if source directory exists
        try {
            await fs.access(CURRENT_NODES_DIR);
        } catch (error) {
            console.error(`❌ Source directory not found: ${CURRENT_NODES_DIR}`);
            process.exit(1);
        }
        
        // Analyze current nodes
        const results = await analyzeCurrentNodes();
        
        // Print report
        printAnalysisReport(results);
        
        // Ask for migration preference
        const args = process.argv.slice(2);
        const dryRun = !args.includes('--execute');
        
        if (dryRun) {
            console.log('💡 This is a DRY RUN. Use --execute to actually perform the migration.\n');
        }
        
        // Create migration structure
        await createMigrationStructure(results, dryRun);
        
        if (dryRun) {
            console.log('\n🎯 Next Steps:');
            console.log('1. Review the migration plan above');
            console.log('2. Run with --execute to perform the actual migration');
            console.log('3. Update your MCP server to use the new structure');
            console.log('4. Test with different N8N versions');
        } else {
            console.log('\n🎉 Migration completed successfully!');
            console.log(`New structure created at: ${NEW_STRUCTURE_DIR}`);
            console.log('\n🎯 Next Steps:');
            console.log('1. Update your MCP server configuration');
            console.log('2. Test the new structure');
            console.log('3. Update documentation');
        }
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Export for testing
module.exports = {
    analyzeCurrentNodes,
    analyzeNode,
    createMigrationStructure,
    N8N_VERSION_MAPPING,
    NODE_CATEGORIES
};

// Run if called directly
if (require.main === module) {
    main();
} 