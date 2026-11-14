#!/usr/bin/env node
// akari-x402 — MCP server over stdio.
// Host config:  { "command": "npx", "args": ["-y", "akari-x402"] }
import { startServer } from '../src/server.js';

startServer();
