/**
 * LLM Service
 * 
 * Provides functions for interacting with Language Model services
 * to generate complex workflow structures and code.
 */

const fetch = require('node-fetch');
const { logger } = require('../utils/logger');
const config = require('../../config/default');

/**
 * Default system prompt for n8n workflow generation
 */
const N8N_WORKFLOW_SYSTEM_PROMPT = `
You are an expert n8n workflow designer. Your task is to create valid n8n workflow JSON structures
based on natural language descriptions. You have deep knowledge of all n8n node types and their configurations.

When generating workflows:
1. Always create valid JSON with proper structure for n8n
2. Include appropriate nodes based on the workflow requirements
3. Set up all node parameters correctly
4. Create proper connections between nodes
5. Position nodes in a logical flow layout
6. Use appropriate trigger nodes (webhook, schedule, etc.)
7. Include detailed documentation within function nodes
8. Ensure node IDs are unique
9. Make sure all connections reference valid node IDs
`;

/**
 * Make an LLM API request
 * 
 * @param {string} prompt - User prompt for the LLM
 * @param {Object} options - Additional options for the request
 * @returns {Promise<Object>} LLM response
 */
async function makeRequest(prompt, options = {}) {
    // Default options
    const defaultOptions = {
        systemPrompt: N8N_WORKFLOW_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 2000,
        provider: 'openai', // Default provider, can be 'openai', 'anthropic', etc.
    };

    const requestOptions = { ...defaultOptions, ...options };

    try {
        logger.debug('Making LLM request', {
            provider: requestOptions.provider,
            promptLength: prompt.length
        });

        // Call appropriate provider based on configuration
        switch (requestOptions.provider) {
            case 'openai':
                return await callOpenAI(prompt, requestOptions);
            case 'anthropic':
                return await callAnthropic(prompt, requestOptions);
            default:
                throw new Error(`Unsupported LLM provider: ${requestOptions.provider}`);
        }
    } catch (error) {
        logger.error('Error making LLM request', { error: error.message, provider: requestOptions.provider });
        throw new Error(`LLM request failed: ${error.message}`);
    }
}

/**
 * Call OpenAI API
 * 
 * @param {string} prompt - User prompt
 * @param {Object} options - Request options
 * @returns {Promise<Object>} LLM response
 */
async function callOpenAI(prompt, options) {
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY || config.llm?.openaiApiKey}`
            },
            body: JSON.stringify({
                model: options.model || 'gpt-4-turbo',
                messages: [
                    { role: 'system', content: options.systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: options.temperature,
                max_tokens: options.maxTokens
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            logger.error('OpenAI API error', { status: response.status, error: errorData });
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
            text: data.choices[0].message.content,
            usage: data.usage,
            provider: 'openai'
        };
    } catch (error) {
        logger.error('Error calling OpenAI API', { error: error.message });
        throw new Error(`OpenAI API call failed: ${error.message}`);
    }
}

/**
 * Call Anthropic API
 * 
 * @param {string} prompt - User prompt
 * @param {Object} options - Request options
 * @returns {Promise<Object>} LLM response
 */
async function callAnthropic(prompt, options) {
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY || config.llm?.anthropicApiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: options.model || 'claude-3-opus-20240229',
                messages: [
                    { role: 'user', content: prompt }
                ],
                system: options.systemPrompt,
                temperature: options.temperature,
                max_tokens: options.maxTokens
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            logger.error('Anthropic API error', { status: response.status, error: errorData });
            throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
            text: data.content[0].text,
            usage: data.usage,
            provider: 'anthropic'
        };
    } catch (error) {
        logger.error('Error calling Anthropic API', { error: error.message });
        throw new Error(`Anthropic API call failed: ${error.message}`);
    }
}

/**
 * Generate an n8n workflow using LLM
 * 
 * @param {string} description - Natural language description of workflow
 * @param {Object} options - LLM request options
 * @returns {Promise<Object>} Generated nodes and connections
 */
async function generateWorkflow(description, options = {}) {
    const workflowPrompt = `
Generate a valid n8n workflow JSON structure based on this description:
"${description}"

The response should include:
1. An array of "nodes" with appropriate parameters, types, and positions
2. A "connections" object defining how nodes are connected

Use common n8n node types like:
- n8n-nodes-base.httpRequest
- n8n-nodes-base.function
- n8n-nodes-base.set
- n8n-nodes-base.if
- n8n-nodes-base.switch
- n8n-nodes-base.noOp
- n8n-nodes-base.emailSend
- n8n-nodes-base.spreadsheetFile
- n8n-nodes-base.webhook
- n8n-nodes-base.scheduleTrigger

Format all positions properly with [x, y] coordinates.
Ensure all node IDs are unique.
Make sure connections reference valid node IDs.

Return ONLY a valid JSON object with these two properties: { "nodes": [...], "connections": {...} }
DO NOT include any explanation, just the JSON object.
`;

    try {
        const response = await makeRequest(workflowPrompt, options);

        // Extract JSON from response
        let jsonText = response.text.trim();

        // If response is wrapped in ```json and ```, remove them
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '');
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```\n/, '').replace(/\n```$/, '');
        }

        // Parse the JSON
        const workflowData = JSON.parse(jsonText);

        // Validate the workflow structure
        if (!workflowData.nodes || !Array.isArray(workflowData.nodes)) {
            throw new Error('Invalid workflow structure: nodes property missing or not an array');
        }

        if (!workflowData.connections || typeof workflowData.connections !== 'object') {
            throw new Error('Invalid workflow structure: connections property missing or not an object');
        }

        return workflowData;
    } catch (error) {
        if (error.message.includes('JSON')) {
            logger.error('Failed to parse LLM response as JSON', { error: error.message });
            throw new Error('Failed to generate valid workflow JSON. The LLM response was not properly formatted.');
        } else {
            logger.error('Error generating workflow with LLM', { error: error.message });
            throw new Error(`Failed to generate workflow: ${error.message}`);
        }
    }
}

module.exports = {
    makeRequest,
    generateWorkflow,
    N8N_WORKFLOW_SYSTEM_PROMPT
}; 