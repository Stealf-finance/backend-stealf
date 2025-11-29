import express from 'express';
import { User } from '../models/User.js';

const router = express.Router();

/**
 * Check if username is available
 * GET /api/users/check-username?username=xxx
 */
router.get('/check-username', async (req, res) => {
  try {
    const { username } = req.query;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        success: false,
        available: false,
        message: 'Username is required',
      });
    }

    // Check minimum length
    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        available: false,
        message: 'Username must be at least 3 characters',
      });
    }

    // Check if username is already taken (case-insensitive)
    const existingUser = await User.findOne({
      username: { $regex: new RegExp(`^${username}$`, 'i') },
    });

    if (existingUser) {
      return res.json({
        success: true,
        available: false,
        message: 'Username is already taken',
      });
    }

    res.json({
      success: true,
      available: true,
      message: 'Username is available',
    });
  } catch (error: any) {
    console.error('Error checking username:', error);
    res.status(500).json({
      success: false,
      available: false,
      message: error.message || 'Internal server error',
    });
  }
});

/**
 * Register or update user with username and wallet
 * POST /api/users/register
 */
router.post('/register', async (req, res) => {
  try {
    const { email, username, solanaWallet, profileImage, gridUserId, gridAddress } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    // Check if username is already taken by another user
    if (username) {
      const existingUser = await User.findOne({
        username: { $regex: new RegExp(`^${username}$`, 'i') },
        email: { $ne: email },
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Username is already taken',
        });
      }
    }

    // Find or create user by email
    let user = await User.findOne({ email });

    if (user) {
      // Update existing user
      if (username) user.username = username;
      if (solanaWallet) user.solanaWallet = solanaWallet;
      if (profileImage !== undefined) user.profileImage = profileImage;
      if (gridUserId) user.gridUserId = gridUserId;
      if (gridAddress) user.gridAddress = gridAddress;
      await user.save();
    } else {
      // Create new user
      const userData: any = {
        email,
        username,
        solanaWallet,
        profileImage,
        gridUserId,
        gridAddress,
      };
      user = new User(userData);
      await user.save();
    }

    console.log(`✅ User registered/updated: ${email} (username: ${username}, wallet: ${solanaWallet})`);

    res.json({
      success: true,
      user: {
        email: user.email,
        username: user.username,
        solanaWallet: user.solanaWallet,
        profileImage: user.profileImage,
      },
    });
  } catch (error: any) {
    console.error('Error registering user:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});

/**
 * Get user profile by email
 * GET /api/users/profile?email=xxx
 */
router.get('/profile', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Email query parameter is required',
      });
    }

    const user = await User.findOne({ email }).select('username solanaWallet profileImage');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      user: {
        username: user.username,
        profileImage: user.profileImage || null,
        solanaWallet: user.solanaWallet,
      },
    });
  } catch (error: any) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});

/**
 * Search user by username
 * GET /api/users/search?username=xxx
 */
router.get('/search', async (req, res) => {
  try {
    const { username } = req.query;

    console.log(`🔍 Searching for username: "${username}"`);

    if (!username || typeof username !== 'string') {
      console.log('❌ No username provided');
      return res.status(400).json({
        success: false,
        message: 'Username query parameter is required',
      });
    }

    // Search for user by username (case-insensitive)
    const user = await User.findOne({
      username: { $regex: new RegExp(`^${username}$`, 'i') },
    }).select('username solanaWallet gridAddress profileImage');

    console.log(`🔍 Search result:`, user ? `Found ${user.username}` : 'Not found');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Return wallet address (prefer solanaWallet, fallback to gridAddress)
    const walletAddress = user.solanaWallet || user.gridAddress;

    if (!walletAddress) {
      return res.status(404).json({
        success: false,
        message: 'User has no wallet address',
      });
    }

    res.json({
      success: true,
      user: {
        username: user.username,
        walletAddress,
        profileImage: user.profileImage || null,
      },
    });
  } catch (error: any) {
    console.error('Error searching user:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});

/**
 * DEBUG: List all users (temporary endpoint)
 * GET /api/users/list
 */
router.get('/list', async (req, res) => {
  try {
    const users = await User.find({}).select('email username solanaWallet gridAddress createdAt');
    console.log(`📋 Found ${users.length} users in database`);
    users.forEach(u => console.log(`   - ${u.email} | username: ${u.username} | wallet: ${u.solanaWallet || u.gridAddress}`));

    res.json({
      success: true,
      count: users.length,
      users: users.map(u => ({
        email: u.email,
        username: u.username,
        solanaWallet: u.solanaWallet,
        gridAddress: u.gridAddress,
      })),
    });
  } catch (error: any) {
    console.error('Error listing users:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});

/**
 * Search users by partial username (autocomplete)
 * GET /api/users/autocomplete?q=xxx
 */
router.get('/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Query must be at least 2 characters',
      });
    }

    // Search for users with username starting with query
    const users = await User.find({
      username: { $regex: new RegExp(`^${q}`, 'i') },
    })
      .select('username profileImage')
      .limit(5);

    res.json({
      success: true,
      users: users.map((u) => ({
        username: u.username,
        profileImage: u.profileImage || null,
      })),
    });
  } catch (error: any) {
    console.error('Error in autocomplete:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});

export default router;
