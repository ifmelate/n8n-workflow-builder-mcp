#!/bin/bash

# Initialize n8n-workflow-builder-mcp project

# Create necessary directories
echo "Creating project directories..."
mkdir -p logs
mkdir -p src/tools
mkdir -p src/models
mkdir -p src/utils
mkdir -p src/middleware
mkdir -p config
mkdir -p tests

# Check if package.json exists
if [ ! -f package.json ]; then
  echo "Creating package.json..."
  npm init -y
fi

# Install dependencies
echo "Installing dependencies..."
npm install express cors dotenv ajv winston morgan

# Install dev dependencies
echo "Installing development dependencies..."
npm install --save-dev eslint prettier nodemon jest

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file from example..."
  cp .env.example .env || echo "# Server Configuration\nPORT=3000\nNODE_ENV=development\nLOG_LEVEL=info\n\n# n8n API Configuration\nN8N_API_URL=http://localhost:5678/api/\nN8N_API_KEY=your_n8n_api_key_here" > .env
fi

echo "Project initialized successfully!"
echo "Run 'npm run dev' to start the development server." 