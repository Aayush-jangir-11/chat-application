// External module
const express = require("express");
const { default: mongoose } = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const io = require("socket.io")(5000, {
  cors: {
    origin: "http://localhost:5173",
  },
});

// Local modules
const Conversation = require("./models/Conversations");
const Message = require("./models/Messages");
const Users = require("./models/User");
const MONGO_URL = "mongodb://127.0.0.1:27017/chat-app";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Socket connection
let users = [];
io.on("connection", (socket) => {
  console.log("User connected", socket.id);
  socket.on("addUser", (userId) => {
    const isUserExist = users.find((user) => user.userId === userId);
    if (!isUserExist) {
      const user = { userId, socketId: socket.id };
      users.push(user);
      io.emit("getUsers", users);
    }
  });

  socket.on(
    "sendMessage",
    ({ senderId, receiverId, message, conversationId }) => {
      const reciver = users.find((user) => user.userId === receiverId);
      const sender = users.find(user => user.userId === senderId);
      if (reciver && sender) {
        io.to(reciver.socketId).to(sender.socketId).emit("getMessage", {
          senderId,
          message,
          conversationId,
          receiverId,
        });
      } else {
         io.to(sender.socketId).emit("getMessage", {
          senderId,
          message,
          conversationId,
          receiverId,
        });
      }
    });

  socket.on("disconnect", () => {
    users = users.filter((user) => user.socketId !== socket.id);
    io.emit("getUsers", users);
  });
});

// Routes
app.get("/", (req, res) => {
  res.send("Welcome to my server");
});

app.post("/api/register", async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      res.status(400).send("Please fill all the required fields");
    } else {
      const isAlreadyExist = await Users.findOne({ email });
      if (isAlreadyExist) {
        res.status(400).send("Email already exists");
      } else {
        // const newUser = new Users({ fullName, email });
        const hashedPassword = await bcrypt.hash(password, 12);
        const newUser = new Users({
          fullName,
          email,
          password: hashedPassword,
        });

        await newUser.save();

        // bcrypt.hash(password, 12, (err, hashedPassword) => {
        //   newUser.set("password", hashedPassword);
        //   newUser.save();
        // });
        return res.status(200).send("User Registered successfully");
      }
    }
  } catch (error) {
    console.error(error);
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).send("Please fill all required fields");
    } else {
      const user = await Users.findOne({ email });
      if (!user) {
        res.status(400).send("User is not valid");
      } else {
        const validateUser = await bcrypt.compare(password, user.password);
        if (!validateUser) {
          res.status(400).send("User is not valid");
        } else {
          const payload = {
            userId: user._id,
            email: user.email,
          };
          const JWT_SECRET_KEY =
            process.env.JWT_SECRET_KEY || "THIS_IS_A_SECRETE_KEY";
          jwt.sign(
            payload,
            JWT_SECRET_KEY,
            { expiresIn: 84600 },
            async (err, token) => {
              await Users.updateOne(
                { _id: user._id },
                {
                  $set: { token },
                },
              );
              // user.save();
              res.status(200).json({
                user: {
                  id: user._id,
                  email: user.email,
                  fullName: user.fullName,
                },
                token: user.token,
              });
            },
          );
          //   user.token = token;
          //   await user.save();
        }
      }
    }
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/conversation", async (req, res, next) => {
  try {
    const { senderId, receiverId } = req.body;
    const newConversation = new Conversation({
      members: [senderId, receiverId],
    });
    await newConversation.save();
    res.status(200).send("Conversation created succesfully");
  } catch (error) {
    console.log(error);
    res.status(500).send("Server Error");
  }
});

app.get("/api/conversation/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const conversations = await Conversation.find({
      members: { $in: [userId] },
    });
    const conversationUserData = await Promise.all(
      conversations.map(async (conversation) => {
        const receiverId = conversation.members.find(
          (member) => member !== userId,
        );
        const user = await Users.findById(receiverId);
        return {
          user: {
            receiverId: user._id,
            email: user.email,
            fullName: user.fullName,
          },
          conversationId: conversation._id,
        };
      }),
    );
    res.status(200).json(await conversationUserData);
  } catch (error) {
    res.status(500).send("Server Error");
  }
});

app.post("/api/message", async (req, res) => {
  try {
    const { conversationId, senderId, message, receiverId = "" } = req.body;

    if (!senderId || !message) {
      return res.status(400).send("Please fill all required fields");
    }

    // create new conversation if not exists
    if (!conversationId || conversationId === "new" && receiverId) {
      const newConversation = new Conversation({
        members: [senderId, receiverId],
      });

      await newConversation.save();

      const newMessage = new Message({
        conversationId: newConversation._id,
        senderId,
        message,
      });

      await newMessage.save();

      return res.status(200).send("Successfully sent");
    }

    // send message in existing conversation
    if (conversationId) {
      const newMessage = new Message({
        conversationId,
        senderId,
        message,
      });

      await newMessage.save();

      return res.status(200).send("Message sent successfully");
    }

    res.status(400).send("Invalid request");
  } catch (error) {
    console.log("Error", error);
    res.status(500).send("Server Error");
  }
});

// app.post('/api/message',async (req,res,next) => {
//     try {
//         const { conversationId, senderId, message, receiverId = '' } = req.body;
//         if (!senderId || !message) return res.status(400).send("Please fill all required felds")
//         if (!conversationId && receiverId) {
//             const newConversation = new Conversation({ members: { senderId, receiverId } });
//             await newConversation.save();
//             const newMessage = new Message({ conversationId: newConversation._id, senderId, message });
//             await newMessage.save();
//             return res.status(200).send('Successfully sent')
//         } else {
//             return res.status(400).send('Please fill required fields')
//         }
//         const newMessage = new Message({ conversationId, senderId, message });
//         await newMessage.save();
//         res.status(200).send('Message sent successfully');
//     } catch (error) {
//         console.log('Error',error);
//     }
// })

app.get("/api/message/:conversationId", async (req, res, next) => {
  try {
    const checkConversation = async (conversationId) => {
      const messages = await Message.find({ conversationId });
      const messageUserData = await Promise.all(
        messages.map(async (message) => {
          const user = await Users.findById(message.senderId);
          return {
            user: {
              id: user._id,
              email: user.email,
              fullName: user.fullName,
            },
            message: message.message,
          };
        }),
      );
      res.status(200).json(await messageUserData);
    };
    const conversationId = req.params.conversationId;
    if (conversationId === "new") {
      const existingConversation = await Conversation.find({
        members: { $all: [req.query.senderId, req.query.receiverId] },
      });
      if (existingConversation.length > 0) {
        return res
          .status(200)
          .json({ conversationId: existingConversation[0]._id });
      } else {
        return res.status(200).json([]);
      }
    } else {
      checkConversation(conversationId);
    }
  } catch (error) {
    console.log("Error", error);
  }
});

app.get("/api/users/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const users = await Users.find({ _id: { $ne: userId } });
    const userData = await Promise.all(
      users.map(async (user) => {
        return {
          user: {
            email: user.email,
            fullName: user.fullName,
            receiverId: user._id,
          },
        };
      }),
    );
    res.status(200).json(userData);
  } catch (error) {
    console.log("Error", error);
  }
});

const PORT = process.env.PORT || 3000;

mongoose
  .connect(MONGO_URL)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database is not connected error", err);
  });
