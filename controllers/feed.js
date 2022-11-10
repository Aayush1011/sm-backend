const fs = require("fs");
const path = require("path");
const { validationResult } = require("express-validator");

const io = require("../socket");
const Post = require("../models/post");
const User = require("../models/user");
const Comment = require("../models/comment");

const ITEMS_PER_PAGE = process.env.ITEMS_PER_PAGE;

exports.getPosts = async (req, res, next) => {
  const currentPage = +req.query.page || 1;
  try {
    const totalItems = await Post.find().countDocuments();
    const posts = await Post.find()
      .populate("creator")
      .sort({ createdAt: -1 })
      .skip((currentPage - 1) * ITEMS_PER_PAGE)
      .limit(ITEMS_PER_PAGE);
    const user = await User.findById(req.userId);
    res.status(200).json({
      message: "Fetched posts successfully",
      posts,
      totalItems,
      likedPosts: user.likes,
    });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.createPost = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error("Validation failed, entered data is incorrect");
    error.statusCode = 422;
    throw error;
  }
  if (!req.file) {
    const error = new Error("No image provided.");
    error.statusCode = 422;
    throw error;
  }
  const imageUrl = req.file.path.split("\\").join("/");
  const title = req.body.title;
  const content = req.body.content;
  const post = new Post({
    title,
    content,
    imageUrl,
    creator: req.userId,
  });
  try {
    await post.save();
    const creator = await User.findById(req.userId);
    creator.posts.push(post);
    await creator.save();
    io.getIO().emit("posts", {
      action: "create",
      post: { ...post._doc, creator: { _id: creator._id, name: creator.name } },
    });
    res.status(201).json({
      message: "Post created successfully",
      post,
      creator: { _id: creator._id, name: creator.name },
    });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.getPost = async (req, res, next) => {
  const postId = req.params.postId;
  try {
    const post = await Post.findById(postId).populate(["creator", "likes"]);
    if (!post) {
      const error = new Error("Could not find post.");
      error.statusCode = 404;
      throw error;
    }
    await User.findById(req.userId);
    const postComments = await Comment.find({ post: postId }).sort({
      createdAt: -1,
    });
    const likers = post.likes.map((like) => {
      return { id: like._id, name: like.name };
    });
    res.status(200).json({
      message: "Post fetched",
      post,
      likers,
      comments: postComments,
    });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.updatePost = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error("Validation failed, entered data is incorrect");
    error.statusCode = 422;
    throw error;
  }
  const postId = req.params.postId;
  const { title, content } = req.body;
  let imageUrl = req.body.image;
  if (req.file) {
    imageUrl = req.file.path.split("\\").join("/");
  }
  if (!imageUrl) {
    const error = new Error("No file picked.");
    error.statusCode = 422;
    throw error;
  }
  try {
    const post = await Post.findById(postId).populate("creator");
    if (!post) {
      const error = new Error("Could not find post.");
      error.statusCode = 404;
      throw error;
    }
    if (post.creator._id.toString() !== req.userId) {
      const error = new Error("Not authorized");
      error.statusCode = 403;
      throw error;
    }
    if (imageUrl !== post.imageUrl) {
      clearImage(post.imageUrl);
    }
    post.title = title;
    post.imageUrl = imageUrl;
    post.content = content;
    const result = await post.save();
    io.getIO().emit("posts", { action: "update", post: result });
    io.getIO().emit("post", { action: "update", post: result });
    res.status(200).json({ message: "Post updated!", post: result });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.deletePost = async (req, res, next) => {
  const postId = req.params.postId;
  try {
    const post = await Post.findById(postId);
    if (!post) {
      const error = new Error("Could not find post.");
      error.statusCode = 404;
      throw error;
    }
    if (post.creator.toString() !== req.userId) {
      const error = new Error("Not authorized");
      error.statusCode = 403;
      throw error;
    }
    clearImage(post.imageUrl);
    await Post.findByIdAndRemove(postId);
    const user = await User.findById(req.userId);
    user.posts.pull(postId);
    await user.save();
    io.getIO().emit("posts", { action: "delete", post: postId });
    res.status(200).json({ message: "Deleted post" });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.addLike = async (req, res, next) => {
  const postId = req.params.postId;
  const flag = req.query.flag;
  try {
    const post = await Post.findById(postId);
    if (!post) {
      const error = new Error("Could not find post.");
      error.statusCode = 404;
      throw error;
    }
    const user = await User.findById(req.userId);
    if (flag === "like") {
      post.likes.push(req.userId);
      user.likes.push(postId);
    } else if (flag === "unlike") {
      post.likes.pull(req.userId);
      user.likes.pull(postId);
    }
    const result = await (await post.save()).populate(["likes", "creator"]);
    const userResult = await user.save();
    const likers = result.likes.map((like) => {
      return { id: like._id, name: like.name };
    });
    io.getIO().emit("posts", {
      action: "like",
      post: result,
      userId: req.userId,
      userLikes: userResult.likes,
    });
    io.getIO().emit("post", {
      action: "like",
      likers,
    });
    res.status(200).json({ message: "Likes updated" });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.addComment = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error("Validation failed, entered data is incorrect");
    error.statusCode = 422;
    throw error;
  }
  const postId = req.params.postId;
  const newComment = req.body.comment;
  try {
    const user = await User.findById(req.userId);
    const comment = new Comment({
      comment: newComment,
      post: postId,
      user: {
        id: req.userId,
        name: user.name,
      },
    });
    user.comments.push(comment);
    await user.save();
    await comment.save();
    const post = await Post.findById(postId);
    post.comments.push(comment);
    await post.save();
    io.getIO().emit("comments", {
      action: "create",
      comment: {
        ...comment._doc,
      },
    });
    res.status(201).json({
      message: "Comment created successfully",
    });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.editComment = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error("Validation failed, entered data is incorrect");
    error.statusCode = 422;
    throw error;
  }
  const commentId = req.params.commentId;
  const newComment = req.body.comment;
  try {
    const comment = await Comment.findById(commentId);
    if (!comment) {
      const error = new Error("Could not find comment.");
      error.statusCode = 404;
      throw error;
    }
    if (comment.user.id.toString() !== req.userId) {
      const error = new Error("Not authorized");
      error.statusCode = 403;
      throw error;
    }
    comment.comment = newComment;
    const result = await comment.save();
    io.getIO().emit("comments", {
      action: "update",
      comment: { ...result._doc },
    });
    res.status(200).json({ message: "Comment updated!", comment: result });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.removeComment = async (req, res, next) => {
  const commentId = req.params.commentId;
  try {
    const comment = await Comment.findById(commentId);
    if (!comment) {
      const error = new Error("Could not find post.");
      error.statusCode = 404;
      throw error;
    }
    if (comment.user.id.toString() !== req.userId) {
      const error = new Error("Not authorized");
      error.statusCode = 403;
      throw error;
    }
    await Comment.findByIdAndRemove(commentId);
    const user = await User.findById(req.userId);
    user.comments.pull(commentId);
    await user.save();
    const post = await Post.findById(comment.post);
    post.comments.pull(commentId);
    await post.save();
    io.getIO().emit("comments", { action: "delete", comment: commentId });
    res.status(200).json({ message: "Deleted post" });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

const clearImage = (filePath) => {
  filePath = path.join(__dirname, "..", filePath);
  fs.unlink(filePath, (err) => console.log(err));
};
