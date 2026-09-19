#!/bin/bash
# Render.com build script

echo "Building Northstar Hospital Portal..."

# Install Python dependencies (none required - using stdlib only)
echo "✓ No external dependencies required"

# Initialize database on first deploy
cd backend
python3 -c "from db import init_db; init_db()"
echo "✓ Database initialized"

echo "Build complete!"
