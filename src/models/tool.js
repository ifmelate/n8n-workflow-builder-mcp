/**
 * Tool Model
 * 
 * Defines the schema and validation for MCP tools
 */

const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true });

// Schema for MCP tool parameter definitions
const parameterSchema = {
    type: 'object',
    properties: {
        type: { type: 'string', enum: ['string', 'number', 'boolean', 'object', 'array', 'integer'] },
        description: { type: 'string' },
        optional: { type: 'boolean' },
        properties: { type: 'object' },  // For nested objects
        items: { type: 'object' }        // For arrays
    },
    required: ['type']
};

// Schema for MCP tool definitions
const toolSchema = {
    type: 'object',
    properties: {
        description: { type: 'string' },
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['object'] },
                properties: {
                    type: 'object',
                    additionalProperties: parameterSchema
                },
                required: {
                    type: 'array',
                    items: { type: 'string' }
                }
            },
            required: ['type', 'properties']
        }
        // Note: We'll validate the execute function separately
    },
    required: ['description', 'parameters']
};

// Validator for tool definitions
const validateTool = ajv.compile(toolSchema);

/**
 * Create a new Tool schema
 * 
 * @param {string} description - Tool description
 * @param {Object} parameters - Parameter definitions
 * @param {Function} execute - Implementation function
 * @returns {Object} Validated tool object
 * @throws {Error} If validation fails
 */
const createTool = (description, parameters, execute) => {
    // Validate execute is a function
    if (typeof execute !== 'function') {
        throw new Error('Tool execute property must be a function');
    }

    // Create the tool object
    const tool = {
        description,
        parameters: {
            type: 'object',
            properties: parameters,
            required: Object.keys(parameters).filter(key => !parameters[key].optional)
        },
        execute
    };

    // Validate the tool schema (excluding execute function)
    const { execute: _, ...toolForValidation } = tool;
    const valid = validateTool(toolForValidation);

    if (!valid) {
        const errors = validateTool.errors.map(err =>
            `${err.instancePath} ${err.message}`
        ).join('; ');

        throw new Error(`Invalid tool definition: ${errors}`);
    }

    return tool;
};

/**
 * Validate tool parameters against schema before execution
 * 
 * @param {Object} tool - Tool definition
 * @param {Object} params - Parameters to validate
 * @returns {Object} Validated and processed parameters
 * @throws {Error} If validation fails
 */
const validateParameters = (tool, params) => {
    // Create validator for this tool's parameters
    const schema = {
        type: 'object',
        properties: {},
        required: tool.parameters.required
    };

    // Build properties schema from tool parameters
    for (const [key, def] of Object.entries(tool.parameters.properties)) {
        schema.properties[key] = {
            type: def.type
        };

        // Add enum if present
        if (def.enum) {
            schema.properties[key].enum = def.enum;
        }

        // Add object properties if present
        if (def.properties) {
            schema.properties[key].properties = def.properties;
        }

        // Add array items if present
        if (def.items) {
            schema.properties[key].items = def.items;
        }
    }

    const validate = ajv.compile(schema);
    const valid = validate(params);

    if (!valid) {
        const errors = validate.errors.map(err =>
            `${err.instancePath} ${err.message}`
        ).join('; ');

        throw new Error(`Invalid parameters: ${errors}`);
    }

    return params;
};

module.exports = {
    createTool,
    validateParameters,
    validateTool
}; 