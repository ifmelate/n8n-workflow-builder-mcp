/**
 * Workflow Generator Demo Script
 * 
 * This script demonstrates how to use the workflow generator
 * to create n8n workflows from natural language descriptions.
 * 
 * Usage:
 * node scripts/demo-workflow-generator.js
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { generateWorkflow } = require('../src/models/llmService');

// Example workflow descriptions
const workflowDescriptions = [
    {
        name: 'API Data Fetcher',
        description: 'Create a workflow that fetches data from a REST API every hour, ' +
            'processes the JSON response to extract user information, and saves it to a CSV file.'
    },
    {
        name: 'Email Notification System',
        description: 'Build a workflow that monitors a folder for new files, and when a new file ' +
            'is detected, sends an email notification with the file name and a summary of its contents.'
    },
    {
        name: 'Data Transformation Pipeline',
        description: 'Create a workflow that takes CSV data, transforms it by cleaning empty fields, ' +
            'standardizing date formats, and calculating a new "total" column, then outputs the processed data.'
    }
];

// Demo function
async function runDemo() {
    try {
        console.log('Workflow Generator Demo');
        console.log('=======================');
        console.log('This demo shows how natural language descriptions can be converted to n8n workflows\n');

        // Create output directory if it doesn't exist
        const outputDir = path.join(process.cwd(), 'generated-workflows');
        await fs.mkdir(outputDir, { recursive: true });
        console.log(`Output directory: ${outputDir}\n`);

        // Select a workflow to generate
        const workflowIndex = 0; // Change this to try different examples
        const selectedWorkflow = workflowDescriptions[workflowIndex];

        console.log(`Generating workflow: ${selectedWorkflow.name}`);
        console.log(`Description: ${selectedWorkflow.description}\n`);
        console.log('Processing...\n');

        // Generate the workflow
        const result = await generateWorkflow(selectedWorkflow.description);

        // Create a complete workflow object
        const workflow = {
            name: selectedWorkflow.name,
            active: false,
            nodes: result.nodes,
            connections: result.connections,
            settings: {
                executionOrder: 'v1',
                saveExecutionProgress: true,
                saveManualExecutions: true,
                saveDataErrorExecution: 'all',
                saveDataSuccessExecution: 'all',
                callerPolicy: 'workflowsFromSameOwner',
                errorWorkflow: ''
            },
            tags: [{ name: 'Generated' }],
            pinData: {},
            id: `demo-workflow-${Date.now()}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save to file
        const outputPath = path.join(outputDir, `${workflow.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`);
        await fs.writeFile(outputPath, JSON.stringify(workflow, null, 2));

        console.log('Workflow generated successfully!');
        console.log(`Saved to: ${outputPath}`);
        console.log(`Contains ${workflow.nodes.length} nodes\n`);

        console.log('Next steps:');
        console.log('1. Copy the workflow JSON file');
        console.log('2. Import it into n8n through the Import from File option');
        console.log('3. Customize any specific parameters as needed');
        console.log('4. Activate and run your workflow!');

    } catch (error) {
        console.error('Demo failed:', error);
    }
}

// Run the demo
runDemo().catch(error => {
    console.error('Unhandled error in demo:', error);
}); 