import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const port = 3000;

  console.log('Starting server initialization...');

  // Health check - must be before Vite middleware
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log('Running in DEVELOPMENT mode with Vite middleware');
    try {
      const vite = await createViteServer({
        server: { 
          middlewareMode: true,
          hmr: {
            port: 3000 // Force HMR to use the same port
          }
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('Vite middleware integrated successfully');
    } catch (viteError) {
      console.error('Failed to start Vite server:', viteError);
      // Fallback to static serving if Vite fails
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
    }
  } else {
    console.log('Running in PRODUCTION mode');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`>>> Server is listening on port ${port}`);
    console.log(`>>> App URL: ${process.env.APP_URL || 'http://localhost:3000'}`);
  });
}

startServer().catch((err) => {
  console.error('CRITICAL: Failed to start server:', err);
});
