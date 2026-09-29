import express from 'express';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { withMetrics, httpMetrics, getMetrics } from './metrics.js';

function log(level: string, event: string, data: Record<string, unknown> = {}) {
  process.stderr.write(
    JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...data }) + '\n'
  );
}

function toolResult(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true as const,
  };
}

// Hardcoded quotes array
const QUOTES = [
  {
    id: '1',
    author: 'Steve Jobs',
    text: 'Stay hungry, stay foolish.',
  },
  {
    id: '2',
    author: 'Albert Einstein',
    text: 'Try not to become a man of success. Rather become a man of value.',
  },
  {
    id: '3',
    author: 'Martin Luther King Jr.',
    text: 'Faith is taking the first step even when you don\'t see the whole staircase.',
  },
  {
    id: '4',
    author: 'Winston Churchill',
    text: 'Success is not final, failure is not fatal: It is the courage to continue that counts.',
  },
  {
    id: '5',
    author: 'Nelson Mandela',
    text: 'It always seems impossible until it\'s done.',
  },
  {
    id: '6',
    author: 'Mark Twain',
    text: 'The two most important days in your life are the day you are born and the day you find out why.',
  },
  {
    id: '7',
    author: 'Mahatma Gandhi',
    text: 'Be the change that you wish to see in the world.',
  },
  {
    id: '8',
    author: 'C.S. Lewis',
    text: 'You are never too old to set another goal or to dream a new dream.',
  },
  {
    id: '9',
    author: 'Roy T. Bennett',
    text: 'Accept yourself, love yourself, and keep moving forward. You\'re worth it.',
  },
  {
    id: '10',
    author: 'Samuel Beckett',
    text: 'Ever tried. Ever failed. No matter. Try again. Fail better.',
  },
];

// --- MCP Handler (stateless: new McpServer instance per request) ---

const handler = createMcpHandler(() => {
  const server = new McpServer(
    { name: 'mcp-quote-of-the-day', version: '2.0.0' },
    { capabilities: { tools: {} } },
  );

  // --- Register tools below ---

  server.registerTool('get-quote', {
    description: 'Get a random inspirational quote',
    inputSchema: {
      // No parameters needed for get-quote
    },
  }, withMetrics('get-quote', async (_args) => {
    try {
      const randomIndex = Math.floor(Math.random() * QUOTES.length);
      const quote = QUOTES[randomIndex];
      return toolResult(quote);
    } catch (error) {
      log('error', 'tool_error', { tool: 'get-quote', error: String(error) });
      return toolError(error);
    }
  }));

  server.registerTool('search-quotes', {
    description: 'Search quotes by keyword',
    inputSchema: {
      keyword: z.string().describe('Keyword to search for in quotes'),
    },
  }, withMetrics('search-quotes', async ({ keyword }) => {
    try {
      const lowercaseKeyword = keyword.toLowerCase();
      const matchingQuotes = QUOTES.filter(
        (quote) => quote.text.toLowerCase().includes(lowercaseKeyword) || quote.author.toLowerCase().includes(lowercaseKeyword),
      );
      return toolResult(matchingQuotes.length > 0 ? matchingQuotes : []);
    } catch (error) {
      log('error', 'tool_error', { tool: 'search-quotes', error: String(error) });
      return toolError(error);
    }
  }));

  // --- End tool registration ---

  return server;
});

// --- Express app ---

const app = express();
app.use(httpMetrics);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'mcp-quote-of-the-day' });
});

app.get('/ready', (_req, res) => {
  res.status(200).json({ status: 'ready', service: 'mcp-quote-of-the-day' });
});

app.get('/metrics', async (_req, res) => {
  const { contentType, metrics } = await getMetrics();
  res.set('Content-Type', contentType);
  res.status(200).send(metrics);
});

const nodeHandler = toNodeHandler(handler);
app.all('/mcp', (req, res) => { void nodeHandler(req, res); });

const port = parseInt(process.env.PORT || '8080', 10);
app.listen(port, () => log('info', 'server_start', { port }));

process.on('SIGTERM', async () => {
  log('info', 'shutdown_initiated');
  await handler.close();
  process.exit(0);
});