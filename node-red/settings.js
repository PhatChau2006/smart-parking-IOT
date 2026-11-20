// All business workflows are in flows.json. These hooks secure Dashboard HTTP/Socket.IO.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
process.env.TZ = 'Asia/Ho_Chi_Minh';
const projectRoot = require('path').resolve(__dirname, '..');
const supabase = require('../lib/supabase-service.cjs').createService({ root: projectRoot });
const verifySession = request => supabase.verifySession(request);
const emailAlarm = require('../lib/email-alarm.cjs').createEmailAlarm({ root: projectRoot });
module.exports = {
  uiPort: Number(process.env.PORT || 1884),
  httpAdminRoot: '/editor',
  httpAdminMiddleware(request, response, next) {
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return next();
    response.status(403).send('Editor chỉ được truy cập từ laptop chạy Node-RED.');
  },
  dashboard: {
    middleware(request, response, next) {
      verifySession(request).then(() => next()).catch(() => response.redirect('/auth/login'));
    },
    ioMiddleware(socket, next) {
      verifySession(socket.request).then(user => {
        const timer = setTimeout(() => socket.disconnect(true), Math.max(1, user.exp * 1000 - Date.now()));
        socket.on('disconnect', () => clearTimeout(timer));
        socket.use((packet, accept) => {
          verifySession(socket.request).then(() => accept()).catch(() => {
            accept(new Error('Session expired'));
            socket.disconnect(true);
          });
        });
        next();
      }).catch(() => next(new Error('Authentication required')));
    }
  },
  flowFile: 'flows.json',
  credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET,
  contextStorage: { default: { module: 'memory' }, disk: { module: 'localfilesystem' } },
  functionGlobalContext: {
    supabase, verifySession, emailAlarm,
    fs: require('fs'), path: require('path'), crypto: require('crypto'),
    mailer: require('nodemailer'), projectRoot: require('path').resolve(__dirname, '..')
  },
  functionExternalModules: false,
  editorTheme: { projects: { enabled: false } }
};
