import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const port = 3000;

  console.log('Starting server initialization...');

  // API routes - Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Error reporting endpoint
  app.use(express.json());
  app.post('/api/report-error', async (req, res) => {
    const { code, message, details, userEmail, path } = req.body;
    
    console.log(`[Error Received] ${code}: ${message}`);

    // If email credentials are provided, try to send mail
    const user = process.env.EMAIL_SERVICE_USER;
    const pass = process.env.EMAIL_SERVICE_PASS;

    if (user && pass) {
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass }
        });

        await transporter.sendMail({
          from: `"HeatShieldings AI" <${user}>`,
          to: 'info@heatshieldings.com',
          subject: `Critical AI Error: ${code}`,
          text: `Error Code: ${code}\nMessage: ${message}\nUser: ${userEmail || 'Anonymous'}\nPath: ${path}\n\nDetails:\n${details}`,
          html: `
            <h3>Critical AI Error Reported</h3>
            <p><strong>Code:</strong> ${code}</p>
            <p><strong>Message:</strong> ${message}</p>
            <p><strong>User:</strong> ${userEmail || 'Anonymous'}</p>
            <p><strong>Path:</strong> ${path}</p>
            <hr/>
            <p><strong>Details:</strong></p>
            <pre style="background:#f4f4f4; p:10px; border-radius:5px;">${details}</pre>
          `
        });
        console.log('Error report email sent successfully.');
      } catch (mailError) {
        console.error('Failed to send error report email:', mailError);
      }
    } else {
      console.warn('EMAIL_SERVICE_USER/PASS not configured. Email not sent.');
    }

    res.status(200).json({ status: 'logged' });
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
