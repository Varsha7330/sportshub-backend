// server.js - SportsHub Backend with MongoDB Atlas & Admin Panel & Real-Time Notifications
// Add this at the top of server.js
require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({ 
  cloud_name: process.env.CLOUD_NAME, 
  api_key: process.env.API_KEY, 
  api_secret: process.env.API_SECRET 
});
// --- Imports ---
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Configures a temporary folder for uploads
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http');
const { WebSocketServer } = require('ws');
const { MongoClient, ObjectId } = require('mongodb');

// --- App Setup ---
const app = express();
const port = process.env.PORT || 3000;

// --- MongoDB Atlas Configuration ---
const MONGODB_URI = 'mongodb+srv://sportsHubAdmin:Adarsh6708@csports-hub-cluster.on9cz2d.mongodb.net/sports-hub-db?retryWrites=true&w=majority&appName=Csports-hub-cluster';
const DB_NAME = 'sports-hub-db';

let db;
let usersCollection;
let eventsCollection;
let chatMessagesCollection;
let adminsCollection;
let categoriesCollection;

// --- WebSocket Client Management ---
const notificationClients = new Map(); // Map of userEmail -> WebSocket connection

// --- Database Connection ---
async function connectToDatabase() {
    try {
        const client = new MongoClient(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
        await client.connect();
        console.log('Successfully connected to MongoDB Atlas!');
        
        db = client.db(DB_NAME);
        usersCollection = db.collection('users');
        eventsCollection = db.collection('events');
        chatMessagesCollection = db.collection('chatMessages');
        adminsCollection = db.collection('admins');
        categoriesCollection = db.collection('categories');
        
        // Create indexes for better performance
        await createIndexes();
        
        // Initialize default data
        await initializeDefaultEvents();
        await initializeDefaultAdmin();
        
        return true;
    } catch (error) {
        console.error('Failed to connect to MongoDB Atlas:', error);
        process.exit(1);
    }
}

async function createIndexes() {
    try {
        await usersCollection.createIndex({ email: 1 }, { unique: true });
        await usersCollection.createIndex({ studentID: 1 }, { unique: true });
        await eventsCollection.createIndex({ id: 1 }, { unique: true });
        await chatMessagesCollection.createIndex({ teamName: 1 });
        await chatMessagesCollection.createIndex({ timestamp: 1 });
        await adminsCollection.createIndex({ email: 1 }, { unique: true });
        console.log('Database indexes created successfully');
    } catch (error) {
        console.log('Some indexes may already exist:', error.message);
    }
}

async function initializeDefaultAdmin() {
    try {
        const adminCount = await adminsCollection.countDocuments();
        if (adminCount === 0) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('admin123', salt);
            
            const defaultAdmin = {
                email: 'admin@college.edu',
                password: hashedPassword,
                fullName: 'SportsHub Administrator',
                role: 'super_admin',
                createdAt: new Date()
            };
            
            await adminsCollection.insertOne(defaultAdmin);
            console.log('Default admin created: admin@college.edu / admin123');
        }
    } catch (error) {
        console.error('Error creating default admin:', error);
    }
}

async function initializeDefaultEvents() {
    try {
        const eventCount = await eventsCollection.countDocuments();
        if (eventCount === 0) {
            const defaultEvents = [
                {
                    id: 1,
                    name: "Cricket Intercollege Championship",
                    date: "2025-10-12",
                    location: "Main Cricket Ground",
                    time: "09:00 AM",
                    category: "Cricket",
                    emoji: "🏏",
                    difficulty: "Advanced",
                    team: {
                        name: "Warriors",
                        maxSlots: 11,
                        members: ["Aditya Kumar"],
                        requirements: {
                            minRegNumber: "2020",
                            minExperience: 2
                        }
                    },
                    createdAt: new Date()
                },
                {
                    id: 2,
                    name: "Annual Badminton Tournament",
                    date: "2025-11-08",
                    location: "Indoor Sports Hall",
                    time: "10:00 AM",
                    category: "Badminton",
                    emoji: "🏸",
                    difficulty: "Intermediate",
                    team: {
                        name: "Shuttlers",
                        maxSlots: 4,
                        members: ["Rahul Patel"],
                        requirements: {
                            minRegNumber: "2021",
                            minExperience: 1
                        }
                    },
                    createdAt: new Date()
                },
                {
                    id: 3,
                    name: "Football Premier League",
                    date: "2025-12-02",
                    location: "Central Stadium",
                    time: "03:30 PM",
                    category: "Football",
                    emoji: "⚽",
                    difficulty: "Expert",
                    team: {
                        name: "Strikers United",
                        maxSlots: 11,
                        members: ["Krishna Rao"],
                        requirements: {
                            minRegNumber: "2019",
                            minExperience: 3
                        }
                    },
                    createdAt: new Date()
                },
                {
                    id: 4,
                    name: "Table Tennis Championship",
                    date: "2025-12-15",
                    location: "TT Arena",
                    time: "12:30 PM",
                    category: "Table Tennis",
                    emoji: "🏓",
                    difficulty: "Intermediate",
                    team: {
                        name: "Spin Masters",
                        maxSlots: 4,
                        members: ["Priya Jain"],
                        requirements: {
                            minRegNumber: "2021",
                            minExperience: 1
                        }
                    },
                    createdAt: new Date()
                }
            ];
            
            await eventsCollection.insertMany(defaultEvents);
            console.log('Default events initialized in database');
        }
    } catch (error) {
        console.error('Error initializing default events:', error);
    }
}

// --- Middleware ---

app.use(cors({
    origin: [
    'http://localhost:3000',
    'https://sportsmanagementsystem.netlify.app',
    'https://sportshub-system.netlify.app'  // Add this
],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../sports-hub-frontend')));

// --- NOTIFICATION FUNCTIONS ---
function sendRealTimeNotification(userEmail, notification) {
    const client = notificationClients.get(userEmail);
    if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
            type: 'notification',
            notification: notification
        }));
        console.log(`Real-time notification sent to: ${userEmail}`);
        return true;
    }
    return false;
}

// --- API Routes ---

// Root endpoint - API status
app.get('/', (req, res) => {
    res.json({ 
        message: 'SportsHub Backend API', 
        status: 'Running',
        version: '1.0.0',
        timestamp: new Date(),
        endpoints: {
            events: '/api/events',
            auth: {
                register: 'POST /api/register',
                login: 'POST /api/login'
            },
            admin: '/admin',
            health: '/health'
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date() });
});

// API documentation endpoint
app.get('/api', (req, res) => {
    res.json({
        message: 'SportsHub API Documentation',
        version: '1.0.0',
        endpoints: {
            'GET /api/events': 'Get all events',
            'POST /api/register': 'Register new user',
            'POST /api/login': 'User login',
            'POST /api/events/:id/join': 'Join event team',
            'POST /api/teams/leave': 'Leave team',
            'POST /api/profile/update': 'Update user profile',
            'GET /api/chat/:teamName': 'Get chat messages',
            'POST /api/notifications/mark-read': 'Mark notifications as read'
        }
    });
});

// Seed admin endpoint
app.get('/api/seed-admin', async (req, res) => {
    try {
        await initializeDefaultAdmin();
        res.status(200).send('Default admin creation process completed. You can now log in.');
    } catch (error) {
        res.status(500).send('Failed to seed admin.');
    }
});

// Seed events endpoint
app.get('/api/seed-events', async (req, res) => {
    try {
        await eventsCollection.deleteMany({});
        await initializeDefaultEvents();
        res.status(200).send('Events have been successfully added to the database!');
    } catch (error) {
        console.error('Seeding error:', error);
        res.status(500).json({ message: 'Failed to seed events.' });
    }
});

// Get all events
app.get('/api/events', async (req, res) => {
    try {
        const events = await eventsCollection.find({}).sort({ id: 1 }).toArray();
        
        // Ensure all events have proper IDs
        const eventsWithIds = events.map((event, index) => {
            if (!event.id && event.id !== 0) {
                console.warn(`Event missing ID, assigning ID: ${index + 1}`, event.name);
                event.id = index + 1;
            }
            return event;
        });
        
        console.log(`Returning ${eventsWithIds.length} events to frontend`);
        res.json(eventsWithIds);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ message: 'Failed to fetch events' });
    }
});

// Register new user
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, studentID, email, password } = req.body;
        
        // Validate required fields
        if (!fullName || !studentID || !email || !password) {
            return res.status(400).json({ message: "All fields are required." });
        }
        
        // Check if user already exists
        const existingUser = await usersCollection.findOne({
            $or: [{ email: email }, { studentID: studentID }]
        });
        
        if (existingUser) {
            if (existingUser.email === email) {
                return res.status(400).json({ message: "User with this email already exists." });
            } else {
                return res.status(400).json({ message: "User with this student ID already exists." });
            }
        }
        
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Create new user
        const newUser = {
            fullName,
            studentID,
            email,
            password: hashedPassword,
            mobileNumber: "",
            avatarUrl: null,
            joinedTeams: [],
            notifications: [{
                icon: "🏆",
                title: `Welcome ${fullName}!`,
                body: "Your account has been created successfully. Explore events and join the fun.",
                timestamp: new Date(),
                read: false
            }],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        const result = await usersCollection.insertOne(newUser);
        console.log('New user registered:', result.insertedId);
        
        res.status(201).json({ message: "User registered successfully!" });
    } catch (error) {
        console.error('Registration error:', error);
        
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({ 
                message: `User with this ${field} already exists.` 
            });
        }
        
        res.status(500).json({ message: "Server error during registration." });
    }
});

// Login user
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required." });
        }
        
        // Find user by email
        const user = await usersCollection.findOne({ email: email });
        if (!user) {
            return res.status(400).json({ message: "Invalid credentials." });
        }
        
        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid credentials." });
        }
        
        // Update last login and add welcome notification
        await usersCollection.updateOne(
            { _id: user._id },
            { 
                $set: { lastLogin: new Date() },
                $push: {
                    notifications: {
                        $each: [{
                            icon: "🏆",
                            title: `Welcome back, ${user.fullName}!`,
                            body: "Ready to join some exciting tournaments?",
                            timestamp: new Date(),
                            read: false
                        }],
                        $slice: -10 // Keep only last 10 notifications
                    }
                }
            }
        );
        
        // Return user data (excluding password)
        const userToReturn = {
            id: user._id,
            fullName: user.fullName,
            email: user.email,
            studentID: user.studentID,
            mobileNumber: user.mobileNumber || "",
            avatarUrl: user.avatarUrl,
            joinedTeams: user.joinedTeams || [],
            notifications: user.notifications || []
        };
        
        res.status(200).json({ message: "Login successful!", user: userToReturn });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: "Server error during login." });
    }
});
// Add this new endpoint to server.js
app.post('/api/profile/avatar-upload', upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        // Upload the file to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: "sports-hub-avatars" // Optional: organize uploads in Cloudinary
        });

        // The user's email will be sent along with the file to identify them
        const { userEmail } = req.body;
        
        // Update the user's document in MongoDB with the new avatar URL
        await usersCollection.updateOne(
            { email: userEmail },
            { $set: { avatarUrl: result.secure_url } }
        );

        console.log(`Avatar updated for ${userEmail}`);
        res.status(200).json({ 
            message: "Avatar updated successfully!", 
            avatarUrl: result.secure_url
        });

    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ message: 'Failed to upload avatar.' });
    }
});

// Mark notifications as read
// In server.js, replace the existing /api/notifications/mark-read endpoint

app.post('/api/notifications/mark-read', async (req, res) => {
    try {
        const { userEmail } = req.body;
        
        if (!userEmail) {
            return res.status(400).json({ message: 'User email is required.' });
        }
        
        // This query finds the user and sets the 'read' field to true 
        // for all sub-documents in the 'notifications' array.
        const result = await usersCollection.updateMany(
            { email: userEmail },
            { $set: { "notifications.$[].read": true } }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        
        console.log(`Marked notifications as read for ${userEmail}`);
        res.status(200).json({ message: 'Notifications marked as read.' });
    } catch (error) {
        console.error('Error marking notifications as read:', error);
        res.status(500).json({ message: 'Failed to mark notifications as read.' });
    }
});

// Join event team
app.post('/api/events/:eventId/join', async (req, res) => {
    try {
        const { eventId } = req.params;
        const { userFullName, userRegNumber, userExperience } = req.body;
        
        // Enhanced debugging
        console.log('Join request - Event ID:', eventId);
        console.log('Join request - User:', userFullName);
        console.log('Join request - RegNumber:', userRegNumber);
        console.log('Join request - Experience:', userExperience);
        
        // Validate required fields
        if (!userFullName || !userRegNumber || userExperience === undefined) {
            return res.status(400).json({ message: 'All fields are required.' });
        }
        
        // Convert eventId to integer and find the event
        const eventIdInt = parseInt(eventId);
        if (isNaN(eventIdInt)) {
            return res.status(400).json({ message: 'Invalid event ID format.' });
        }
        
        const event = await eventsCollection.findOne({ id: eventIdInt });
        console.log('Found event:', event ? event.name : 'No event found');
        
        if (!event) {
            return res.status(404).json({ message: 'Event not found.' });
        }
        
        if (!event.team) {
            return res.status(404).json({ message: 'Team information not found for this event.' });
        }
        
        // Check if user is already in the team
        if (event.team.members.includes(userFullName)) {
            return res.status(400).json({ message: 'You are already a member of this team.' });
        }
        
        // Validate requirements
        const { requirements } = event.team;
        const userRegYear = parseInt(userRegNumber.substring(0, 4));
        const minRegYear = parseInt(requirements.minRegNumber);
        
        if (userRegYear > minRegYear) {
            return res.status(400).json({ 
                message: `Application rejected. Minimum registration year is ${requirements.minRegNumber}.` 
            });
        }
        
        if (userExperience < requirements.minExperience) {
            return res.status(400).json({ 
                message: `Application rejected. Minimum ${requirements.minExperience} years of experience required.` 
            });
        }
        
        if (event.team.members.length >= event.team.maxSlots) {
            return res.status(400).json({ message: 'Sorry, this team is full.' });
        }
        
        // Add user to team
        const updateResult = await eventsCollection.updateOne(
            { id: eventIdInt },
            { 
                $push: { "team.members": userFullName },
                $set: { updatedAt: new Date() }
            }
        );
        
        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: 'Failed to update event.' });
        }
        
        // Update user's joined teams
        await usersCollection.updateOne(
            { fullName: userFullName },
            { 
                $push: { 
                    joinedTeams: {
                        eventId: eventIdInt,
                        eventName: event.name,
                        teamName: event.team.name,
                        emoji: event.emoji,
                        joinedAt: new Date()
                    }
                },
                $set: { updatedAt: new Date() }
            }
        );
        
        console.log(`${userFullName} successfully joined ${event.team.name}`);
        res.json({ message: `Successfully joined ${event.team.name}!` });
        
    } catch (error) {
        console.error('Join team error:', error);
        res.status(500).json({ message: 'Failed to join team. Please try again.' });
    }
});

// Leave team
app.post('/api/teams/leave', async (req, res) => {
    try {
        const { userFullName, teamName } = req.body;
        
        // Validate required fields
        if (!userFullName || !teamName) {
            return res.status(400).json({ message: "User name and team name are required." });
        }
        
        // Find and update the event
        const updateResult = await eventsCollection.updateOne(
            { "team.name": teamName },
            { 
                $pull: { "team.members": userFullName },
                $set: { updatedAt: new Date() }
            }
        );
        
        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        
        if (updateResult.modifiedCount === 0) {
            return res.status(400).json({ message: 'You were not a member of this team.' });
        }
        
        // Remove team from user's joined teams
        await usersCollection.updateOne(
            { fullName: userFullName },
            { 
                $pull: { joinedTeams: { teamName: teamName } },
                $set: { updatedAt: new Date() }
            }
        );
        
        console.log(`${userFullName} left ${teamName}`);
        res.json({ message: `You have left ${teamName}.` });
    } catch (error) {
        console.error('Leave team error:', error);
        res.status(500).json({ message: 'Failed to leave team.' });
    }
});

// Update user profile
app.post('/api/profile/update', async (req, res) => {
    try {
        const { email, fullName, mobileNumber } = req.body;
        
        // Validate required fields
        if (!email || !fullName) {
            return res.status(400).json({ message: "Email and full name are required." });
        }
        
        const updateResult = await usersCollection.findOneAndUpdate(
            { email: email },
            { 
                $set: { 
                    fullName: fullName,
                    mobileNumber: mobileNumber || "",
                    updatedAt: new Date()
                }
            },
            { returnDocument: 'after' }
        );
        
        if (!updateResult.value) {
            return res.status(404).json({ message: "User not found." });
        }
        
        const user = updateResult.value;
        const userToReturn = {
            id: user._id,
            fullName: user.fullName,
            email: user.email,
            studentID: user.studentID,
            mobileNumber: user.mobileNumber
        };
        
        console.log("Profile updated for:", email);
        res.status(200).json({ message: "Profile updated successfully!", user: userToReturn });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ message: "Failed to update profile." });
    }
});

// Get chat messages for a team
app.get('/api/chat/:teamName', async (req, res) => {
    try {
        const { teamName } = req.params;
        const messages = await chatMessagesCollection
            .find({ teamName: teamName })
            .sort({ timestamp: 1 })
            .limit(100)
            .toArray();
        
        res.json(messages);
    } catch (error) {
        console.error('Error fetching chat messages:', error);
        res.status(500).json({ message: 'Failed to fetch chat messages' });
    }
});

// --- ADMIN ROUTES ---

// Serve admin panel
app.get('/admin', (req, res) => {
    res.send(`
        <html>
            <head><title>SportsHub Admin</title></head>
            <body>
                <h1>SportsHub Admin Panel</h1>
                <p>Admin functionality available via API endpoints.</p>
                <p>Default Admin: admin@college.edu / admin123</p>
            </body>
        </html>
    `);
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required." });
        }
        
        const admin = await adminsCollection.findOne({ email: email });
        if (!admin) {
            return res.status(400).json({ message: "Invalid admin credentials." });
        }
        
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid admin credentials." });
        }
        
        await adminsCollection.updateOne(
            { _id: admin._id },
            { $set: { lastLogin: new Date() } }
        );
        
        const adminToReturn = {
            id: admin._id,
            email: admin.email,
            fullName: admin.fullName,
            role: admin.role
        };
        
        console.log('Admin logged in:', admin.email);
        res.status(200).json({ message: "Admin login successful!", admin: adminToReturn });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ message: "Server error during admin login." });
    }
});

// Admin endpoint to create a new event
app.post('/api/admin/events', async (req, res) => {
    try {
        const eventData = req.body;
        
        if (!eventData.name || !eventData.teamName) {
            return res.status(400).json({ message: 'Event Name and Team Name are required.' });
        }

        const newEvent = {
            id: await eventsCollection.countDocuments() + 1,
            name: eventData.name,
            date: eventData.date,
            location: eventData.location,
            time: eventData.time,
            category: eventData.category,
            emoji: eventData.emoji,
            difficulty: eventData.difficulty,
            team: {
                name: eventData.teamName,
                maxSlots: parseInt(eventData.maxSlots),
                members: [],
                requirements: {
                    minRegNumber: eventData.minRegYear,
                    minExperience: parseInt(eventData.minExperience)
                }
            },
            createdAt: new Date()
        };

        await eventsCollection.insertOne(newEvent);
        console.log('Admin created new event:', newEvent.name);
        res.status(201).json({ message: 'Event created successfully!', event: newEvent });

    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ message: 'Failed to create event.' });
    }
});

// Admin endpoint to delete an event
app.delete('/api/admin/events/:eventId', async (req, res) => {
    try {
        const eventId = parseInt(req.params.eventId);
        if (isNaN(eventId)) {
            return res.status(400).json({ message: 'Invalid Event ID.' });
        }

        const result = await eventsCollection.deleteOne({ id: eventId });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Event not found.' });
        }
        
        console.log('Admin deleted event with ID:', eventId);
        res.status(200).json({ message: 'Event deleted successfully.' });

    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ message: 'Failed to delete event.' });
    }
});

// Admin send notifications
app.post('/api/admin/notifications/send', async (req, res) => {
    try {
        const { title, message, icon, target, specificEmail } = req.body;

        if (!title || !message || !icon || !target) {
            return res.status(400).json({ message: 'Missing required notification fields.' });
        }

        const newNotification = {
            icon,
            title,
            body: message,
            timestamp: new Date(),
            read: false
        };

        let targetQuery = {};
        let targetUsers = [];
        
        if (target === 'all') {
            targetQuery = {};
            // Get all user emails for real-time delivery
            const users = await usersCollection.find({}, { projection: { email: 1 } }).toArray();
            targetUsers = users.map(user => user.email);
        } else if (target === 'specific') {
            if (!specificEmail) {
                return res.status(400).json({ message: 'Specific user email is required.' });
            }
            targetQuery = { email: specificEmail };
            targetUsers = [specificEmail];
        }

        // Update database
        const result = await usersCollection.updateMany(targetQuery, {
            $push: {
                notifications: {
                    $each: [newNotification],
                    $slice: -10 // Keep only the last 10 notifications
                }
            }
        });

        // Send real-time notifications
        let realTimeDelivered = 0;
        targetUsers.forEach(email => {
            if (sendRealTimeNotification(email, newNotification)) {
                realTimeDelivered++;
            }
        });

        console.log(`Notification sent to ${result.modifiedCount} users (${realTimeDelivered} real-time)`);
        res.status(200).json({ 
            message: 'Notification sent successfully!', 
            sentCount: result.modifiedCount,
            realTimeDelivered: realTimeDelivered
        });

    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ message: 'Failed to send notification.' });
    }
});

// Get all users (Admin only)
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await usersCollection
            .find({}, { projection: { password: 0 } })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
});

// Get all events (Admin only)
app.get('/api/admin/events', async (req, res) => {
    try {
        const events = await eventsCollection.find({}).sort({ id: 1 }).toArray();
        res.json(events);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ message: 'Failed to fetch events' });
    }
});

// Get categories
app.get('/api/admin/categories', async (req, res) => {
    try {
        const categories = await categoriesCollection.find({}).sort({ name: 1 }).toArray();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch categories.' });
    }
});

// Add category
app.post('/api/admin/categories', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Category name is required.' });
        }
        const existingCategory = await categoriesCollection.findOne({ name: name });
        if (existingCategory) {
            return res.status(400).json({ message: 'This category already exists.' });
        }
        const newCategory = { name: name, createdAt: new Date() };
        await categoriesCollection.insertOne(newCategory);
        res.status(201).json({ message: 'Category added successfully!', category: newCategory });
    } catch (error) {
        res.status(500).json({ message: 'Failed to add category.' });
    }
});

// Delete category
app.delete('/api/admin/categories/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid category ID format.' });
        }
        const result = await categoriesCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Category not found.' });
        }
        res.status(200).json({ message: 'Category deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete category.' });
    }
});

// Save chat message function
async function saveChatMessage(messageData) {
    try {
        const message = {
            teamName: messageData.teamName,
            sender: messageData.sender,
            text: messageData.text,
            timestamp: new Date()
        };
        
        await chatMessagesCollection.insertOne(message);
        return message;
    } catch (error) {
        console.error('Error saving chat message:', error);
        return null;
    }
}

// --- WebSocket Setup ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    if (url.pathname === '/notifications') {
        handleNotificationConnection(ws);
    } else {
        handleChatConnection(ws);
    }
});

// Handle notification WebSocket connections
function handleNotificationConnection(ws) {
    console.log('New notification WebSocket client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'register' && data.userEmail) {
                notificationClients.set(data.userEmail, ws);
                console.log(`Notification client registered for: ${data.userEmail}`);
            }
        } catch (error) {
            console.error('Notification WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        // Remove this connection from all registered users
        for (const [email, connection] of notificationClients.entries()) {
            if (connection === ws) {
                notificationClients.delete(email);
                console.log(`Notification client disconnected: ${email}`);
                break;
            }
        }
    });
}

// Handle chat WebSocket connections
function handleChatConnection(ws) {
    console.log('New chat WebSocket client connected');
    ws.teamName = null;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'join') {
                ws.teamName = data.teamName;
                console.log(`Client joined team chat: ${ws.teamName}`);
            }
            
            if (data.type === 'message') {
                const savedMessage = await saveChatMessage({
                    teamName: ws.teamName,
                    sender: data.sender,
                    text: data.text
                });
                
                if (savedMessage) {
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && client.teamName === ws.teamName) {
                            client.send(JSON.stringify({
                                type: 'message',
                                sender: savedMessage.sender,
                                text: savedMessage.text,
                                timestamp: savedMessage.timestamp
                            }));
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Chat WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Chat WebSocket client disconnected');
    });
}

// --- Error Handling ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- Start Server ---
async function startServer() {
    try {
        await connectToDatabase();
        
        server.listen(port, () => {
            console.log(`🚀 SportsHub Server running on port ${port}`);
            console.log(`📊 Database: Connected to MongoDB Atlas`);
            console.log(`💬 WebSocket: Real-time chat enabled`);
            console.log(`🔔 Notifications: Real-time delivery enabled`);
            console.log(`🏆 Ready for sports management!`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();