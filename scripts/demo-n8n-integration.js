/**
 * n8n Integration Demo Script
 * 
 * This script demonstrates how to use the n8n integration module
 * to deploy, activate, and manage workflows in n8n.
 * 
 * Usage:
 * node scripts/demo-n8n-integration.js
 */

require('dotenv').config();
const path = require('path');
const { n8nIntegration, getIntegrationType } = require('../src/models/n8nIntegration');
const { workflowStorage } = require('../src/models/storage');

// Sample workflow data
const sampleWorkflow = {
    name: 'Sample API Request Workflow',
    active: false,
    nodes: [
        {
            parameters: {
                url: 'https://jsonplaceholder.typicode.com/posts/1',
                authentication: 'none',
                method: 'GET',
                options: {}
            },
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 1,
            position: [100, 100],
            id: 'http-node-1'
        },
        {
            parameters: {},
            name: 'No Operation',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [300, 100],
            id: 'no-op-node-1'
        }
    ],
    connections: {
        'http-node-1': {
            main: [
                [
                    {
                        node: 'no-op-node-1',
                        type: 'main',
                        index: 0
                    }
                ]
            ]
        }
    },
    id: 'sample-workflow-' + Date.now(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
};

// File path for the workflow
const workflowPath = path.join(process.cwd(), 'workflow_nodes', `${sampleWorkflow.id}.json`);

// Demo function
async function runDemo() {
    try {
        console.log('n8n Integration Demo');
        console.log('===================');
        console.log(`Integration type: ${getIntegrationType()}`);
        console.log('');

        // 1. Save workflow to filesystem
        console.log('1. Saving workflow to filesystem...');
        await workflowStorage.saveWorkflow(
            sampleWorkflow.id,
            sampleWorkflow,
            workflowPath
        );
        console.log('   Workflow saved to:', workflowPath);
        console.log('');

        // 2. Deploy workflow to n8n
        console.log('2. Deploying workflow to n8n...');
        try {
            const deployResult = await n8nIntegration.deployWorkflow(workflowPath);
            console.log('   Deployment result:', JSON.stringify(deployResult, null, 2));
        } catch (error) {
            console.error('   Deployment error:', error.message);
            // Continue with demo even if deploy fails
        }
        console.log('');

        // 3. List workflows in n8n
        console.log('3. Listing workflows in n8n...');
        try {
            const listResult = await n8nIntegration.listWorkflows();
            console.log(`   Found ${listResult.count} workflows:`);
            listResult.workflows.forEach(wf => {
                console.log(`   - ${wf.name} (ID: ${wf.id}, Active: ${wf.active})`);
            });
        } catch (error) {
            console.error('   List error:', error.message);
        }
        console.log('');

        // 4. Activate workflow
        console.log('4. Activating workflow...');
        try {
            const activateResult = await n8nIntegration.activateWorkflow(workflowPath, true);
            console.log('   Activation result:', JSON.stringify(activateResult, null, 2));
        } catch (error) {
            console.error('   Activation error:', error.message);
        }
        console.log('');

        // 5. Check execution status (only works with API integration)
        if (getIntegrationType() === 'api') {
            console.log('5. Checking execution status...');
            try {
                // Wait a moment for possible execution
                await new Promise(resolve => setTimeout(resolve, 2000));

                const statusResult = await n8nIntegration.checkExecutionStatus(sampleWorkflow.id);
                if (statusResult.hasExecutions) {
                    console.log('   Latest execution:', JSON.stringify(statusResult.latestExecution, null, 2));
                } else {
                    console.log('   No executions found for this workflow.');
                }
            } catch (error) {
                console.error('   Status check error:', error.message);
            }
            console.log('');
        }

        // 6. Deactivate workflow
        console.log('6. Deactivating workflow...');
        try {
            const deactivateResult = await n8nIntegration.activateWorkflow(workflowPath, false);
            console.log('   Deactivation result:', JSON.stringify(deactivateResult, null, 2));
        } catch (error) {
            console.error('   Deactivation error:', error.message);
        }
        console.log('');

        console.log('Demo completed!');
        console.log('');
        console.log('Notes:');
        console.log('- For API integration, ensure n8n is running with REST API enabled');
        console.log('- Set N8N_API_URL and N8N_API_KEY in your .env file');
        console.log('- For filesystem integration, set N8N_WORKFLOWS_PATH in your .env file');
        console.log('- You can explicitly set N8N_INTEGRATION_TYPE to "api" or "filesystem"');

    } catch (error) {
        console.error('Demo failed:', error);
    }
}

// Run the demo
runDemo().catch(error => {
    console.error('Unhandled error in demo:', error);
}); 