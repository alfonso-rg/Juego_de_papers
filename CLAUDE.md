# Quiz Papers

A multiplayer quiz game about scientific papers where players compete to test their knowledge of research publications through timeline ordering and attribute matching challenges.

## Overview

Quiz Papers is a real-time multiplayer web game designed to make learning about scientific papers fun and competitive. Players can play solo or compete in duels, earning points for correct answers.

## Features

### Game Modes

#### Timeline Mode
- Order papers chronologically from oldest to newest
- Drag-and-drop interface with touch support
- Handles papers with same publication year intelligently
- Points awarded for first-try success

#### Matching Mode
- Match papers with their attributes (authors, year, journal)
- Click-to-select or drag-and-drop interaction
- Mobile-optimized touch controls
- Visual feedback for correct/incorrect placements

### Multiplayer System
- Real-time duels using Socket.io
- Lobby system for creating and joining games
- 2-3 player support
- Configurable paper count (3-5 papers)
- Points awarded based on finish position (1st: 3pts, 2nd: 2pts, 3rd: 1pt)

### Scoring System
- Weekly rankings (resettable)
- Historical total scores
- Points for perfect first attempts
- Penalties for failed first attempts
- Hall of Fame leaderboards

### Administration
- Add, edit, and delete papers
- Manage player scores
- Reset weekly or total rankings
- Paper count tracking

## Technical Stack

### Frontend
- Vanilla JavaScript (ES6+)
- Socket.io client for real-time multiplayer
- SweetAlert2 for notifications
- SortableJS for drag-and-drop
- Responsive CSS with mobile-first design

### Mobile Support
- Touch events handling
- Click-to-select alternative to drag-and-drop
- Visual clone for touch dragging
- Optimized touch targets (44px minimum)
- Responsive grid layouts

### Interaction Methods
1. **Desktop**: Traditional drag-and-drop
2. **Mobile**: Touch drag with visual feedback
3. **Universal**: Click-to-select system (click chip, click destination)

## Game Rules

### Timeline Game
- Papers must be ordered chronologically
- Papers with the same year can be in any order relative to each other
- First correct attempt: +N points (N = number of papers)
- First incorrect attempt: -(N-1) points penalty
- Subsequent attempts: no points

### Matching Game
- Match each paper's year, authors, and journal correctly
- All attributes must be assigned to submit
- First perfect match: +N points
- First incomplete/wrong match: -(N-1) points penalty
- Subsequent attempts: no points

### Duel Mode
- Race to complete the challenge correctly
- Finish order determines points
- Incorrect submissions don't finish - keep trying
- Players can see opponents in the waiting room

## Security

### Authentication & Authorization
- **JWT-based authentication**: All users must login with username/password to receive a token
- **Token expiration**: 24 hours (configurable)
- **Password hashing**: bcryptjs with salt rounds for secure password storage
- **Protected endpoints**: All API routes require valid JWT token
- **Socket.io authentication**: Real-time connections validated with JWT

### Input Validation & Sanitization
- **express-validator**: Validates all user inputs (length, type, format)
- **NoSQL injection prevention**: Strict type checking and sanitization
- **XSS prevention**: Input escaping and sanitization
- **Size limits**: 10kb payload limit on JSON requests
- **Field constraints**: Max lengths on all string fields (titles, authors, etc.)

### Rate Limiting
- **General limit**: 100 requests per 15 minutes per IP
- **Strict limit**: 10 requests per 15 minutes for sensitive operations (login, admin actions)
- **DDoS protection**: Prevents server saturation

### CORS & Network Security
- **Whitelist origins**: Only allowed domains can make requests
- **Configurable via .env**: `ALLOWED_ORIGINS` environment variable
- **Credentials support**: Secure cookie and auth header handling

### Additional Security Measures
- **Helmet.js**: Security headers (XSS, clickjacking, etc.)
- **Crypto-secure IDs**: Game IDs generated with crypto.randomBytes()
- **Audit logging**: Admin actions logged to console
- **Password requirements**: Enforced at application level
- **.env protection**: Sensitive data in environment variables, not code

### Setup Instructions

1. **Generate JWT Secret**:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

2. **Configure .env file**:
```env
JWT_SECRET=your-generated-secret-here
MONGO_URI=your-mongodb-connection-string
ALLOWED_ORIGINS=https://your-domain.com
DEFAULT_PASSWORD=temporary-password-for-init
```

3. **Initialize players** (only once):
Visit `/init-players` to create default users with temporary passwords

4. **Change passwords immediately** after first login

### Deployment on Render

1. Add environment variables in Render dashboard:
   - `JWT_SECRET`
   - `MONGO_URI`
   - `ALLOWED_ORIGINS` (your Render URL)
   - `DEFAULT_PASSWORD`

2. Ensure `.env` is in `.gitignore` (already configured)

3. Update ALLOWED_ORIGINS to include your Render domain:
   ```env
   ALLOWED_ORIGINS=https://your-app.onrender.com
   ```

### Security Checklist

- [x] JWT authentication implemented
- [x] Password hashing with bcrypt
- [x] Input validation on all endpoints
- [x] NoSQL injection prevention
- [x] XSS protection
- [x] Rate limiting
- [x] CORS whitelist
- [x] Helmet security headers
- [x] Socket.io authentication
- [x] Audit logging for admin actions
- [ ] HTTPS enforcement (configure in Render)
- [ ] Regular security audits
- [ ] Backup strategy for MongoDB

## User Experience Features

- Gradient backgrounds with glassmorphism design
- Color-coded attribute chips (year=red, authors=blue, journal=green)
- Animated feedback for selections and interactions
- Loading states and progress indicators
- Responsive layouts for all screen sizes
- Accessibility considerations for touch devices

## Project Structure

```
Juego Papers/
├── public/
│   ├── index.html      # Main HTML structure
│   ├── script.js       # Client-side game logic
│   └── style.css       # Styling and responsive design
├── server.js           # Backend (Node.js + Express + Socket.io)
└── CLAUDE.md           # This file
```

## Development Notes

### Key Improvements Implemented
- Intelligent timeline validation (handles year ties)
- Dual-mode interaction (drag OR click-to-select)
- Enhanced mobile touch handling with visual feedback
- Prevention of accidental selections during scrolling
- Responsive design with device-specific optimizations

### Future Enhancements
- User registration system
- More game modes
- Paper categories/filters
- Achievement system
- Enhanced statistics and analytics
- Export/import paper database

## Credits

Developed with Claude Code assistance for the Ocio/Creaciones IA collection.
