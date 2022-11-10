const express = require("express");
const { body } = require("express-validator");

const feedController = require("../controllers/feed");
const isAuth = require("../middleware/is-auth");

const router = express.Router();

router.get("/posts", isAuth, feedController.getPosts);

router.post(
  "/post",
  isAuth,
  [
    body("title").trim().isLength({ min: 5 }),
    body("content").trim().isLength({ min: 5 }),
  ],
  feedController.createPost
);

router.get("/post/:postId", isAuth, feedController.getPost);

router.put(
  "/post/:postId",
  isAuth,
  [
    body("title").trim().isLength({ min: 5 }),
    body("content").trim().isLength({ min: 5 }),
  ],
  feedController.updatePost
);

router.delete("/post/:postId", isAuth, feedController.deletePost);

router.post("/post/like/:postId", isAuth, feedController.addLike);

router.post(
  "/post/comments/:postId",
  [body("comment").trim().not().isEmpty()],
  isAuth,
  feedController.addComment
);

router.put(
  "/post/comments/:commentId",
  [body("comment").trim().not().isEmpty()],
  isAuth,
  feedController.editComment
);

router.delete(
  "/post/comments/:commentId",
  isAuth,
  feedController.removeComment
);

module.exports = router;
