import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createManagementFixture } from "./helpers/management-fixture.mjs";

test("reply notifications, notification blocks and content report decisions are private and actionable", async (t) => {
  const fixture = await createManagementFixture();
  t.after(() => fixture.close());
  const { request, owner, query } = fixture;
  const password = fixture.password;
  async function register(username) {
    const response = await request(
      "POST",
      "/api/auth/register",
      {
        username,
        displayName: username,
        email: `${username}@example.test`,
        password,
      },
      null,
    );
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  }
  const author = await register("report_author");
  const replyer = await register("notification_replyer");
  const nested = await register("notification_nested");
  const reporter = await register("content_reporter");
  const manager = fixture.managers.find(
    (item) => item.permission === "posts.manage",
  );
  const category = (await request("GET", "/api/categories")).json()[0];
  const body = (text) => ({ blocks: [{ type: "paragraph", data: { text } }] });
  const post = await request(
    "POST",
    "/api/posts",
    {
      categoryId: category.id,
      title: "举报与回复通知验收",
      body: body("帖子正文内容"),
    },
    author,
  );
  assert.equal(post.statusCode, 201, post.body);
  const postId = post.json().post.id;

  const root = await request(
    "POST",
    `/api/posts/${postId}/replies`,
    { body: body("主回复内容摘要") },
    replyer,
  );
  assert.equal(root.statusCode, 201, root.body);
  const rootId = root.json().reply.id;
  const child = await request(
    "POST",
    `/api/posts/${postId}/replies`,
    {
      parentReplyId: rootId,
      replyToId: rootId,
      body: body("楼中楼回复摘要"),
    },
    nested,
  );
  assert.equal(child.statusCode, 201, child.body);
  const childId = child.json().reply.id;
  const authorReplies = await request(
    "GET",
    "/api/me/notifications?kind=reply&page=1",
    undefined,
    author,
  );
  assert.equal(authorReplies.statusCode, 200);
  assert.equal(authorReplies.json().total, 1);
  assert.match(
    authorReplies.json().notices[0].body,
    /notification_replyer回复了你：主回复内容摘要/,
  );
  const rootReplies = await request(
    "GET",
    "/api/me/notifications?kind=reply&page=1",
    undefined,
    replyer,
  );
  assert.equal(rootReplies.json().total, 1);
  assert.match(
    rootReplies.json().notices[0].body,
    /notification_nested回复了你：楼中楼回复摘要/,
  );
  const location = await request(
    "GET",
    `/api/posts/${postId}/replies/${childId}/location`,
    undefined,
    replyer,
  );
  assert.deepEqual(location.json(), { page: 1, childPage: 1, rootId });

  assert.equal(
    (
      await request(
        "POST",
        "/api/me/notification-blocks",
        { username: "notification_nested" },
        replyer,
      )
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await request(
        "GET",
        "/api/me/notifications?kind=reply&page=1",
        undefined,
        replyer,
      )
    ).json().total,
    0,
  );
  assert.equal(
    (
      await request("GET", "/api/me/notifications/unread", undefined, replyer)
    ).json().count,
    0,
  );
  const blocks = await request(
    "GET",
    "/api/me/notification-blocks?page=1",
    undefined,
    replyer,
  );
  assert.equal(blocks.json().blocks[0].username, "notification_nested");
  assert.equal(
    (
      await request(
        "DELETE",
        `/api/me/notification-blocks/${nested.user.uid}`,
        undefined,
        replyer,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        "GET",
        "/api/me/notifications?kind=reply&page=1",
        undefined,
        replyer,
      )
    ).json().total,
    1,
  );

  const postReport = await request(
    "POST",
    "/api/reports",
    {
      targetType: "post",
      postId,
      reason: "请核查帖子内容",
    },
    reporter,
  );
  assert.equal(postReport.statusCode, 201, postReport.body);
  assert.equal(
    (
      await request(
        "POST",
        "/api/reports",
        { targetType: "post", postId, reason: "重复举报" },
        reporter,
      )
    ).statusCode,
    409,
  );
  const postReports = await request(
    "GET",
    "/api/admin/reports?status=pending&page=1",
    undefined,
    manager,
  );
  assert.equal(postReports.statusCode, 200);
  assert.equal(postReports.json().reports[0].post_title, "举报与回复通知验收");
  assert.equal(
    (await request("GET", "/api/admin/reports", undefined, author)).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/reports/${postReport.json().id}/resolve`,
        { action: "hide" },
        manager,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await query("SELECT status FROM posts WHERE id=$1", [postId])).rows[0]
      .status,
    "hidden",
  );

  const replyReport = await request(
    "POST",
    "/api/reports",
    {
      targetType: "reply",
      postId,
      replyId: childId,
      reason: "这条楼中楼需要管理员查看",
    },
    reporter,
  );
  assert.equal(replyReport.statusCode, 201, replyReport.body);
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/reports/${replyReport.json().id}/resolve`,
        { action: "delete_reply" },
        manager,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await query("SELECT id FROM replies WHERE id=$1", [childId])).rowCount,
    0,
  );
  assert.equal(
    (
      await query(
        "SELECT 1 FROM audit_events WHERE action_key='reply.delete' AND target_id=$1",
        [childId],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await query(
        "SELECT details->>'targetId' AS target FROM audit_events WHERE action_key='report.resolve' AND target_id=$1",
        [replyReport.json().id],
      )
    ).rows[0].target,
    childId,
  );
  assert.ok(
    (await request("GET", "/api/me/notifications", undefined, nested))
      .json()
      .some(
        (notice) =>
          notice.kind === "moderation" &&
          notice.body.includes("回复已被管理员删除"),
      ),
  );

  // Post authors can report other people's replies on their own threads.
  const authorReport = await request(
    "POST",
    "/api/reports",
    {
      targetType: "reply",
      postId,
      replyId: rootId,
      reason: "作者举报他人的主回复",
    },
    author,
  );
  assert.equal(authorReport.statusCode, 201, authorReport.body);
  const retained = await request(
    "POST",
    `/api/posts/${postId}/replies`,
    {
      parentReplyId: rootId,
      body: body("保留的楼中楼"),
    },
    nested,
  );
  assert.equal(retained.statusCode, 201, retained.body);
  const removeRoot = await request(
    "POST",
    `/api/admin/reports/${authorReport.json().id}/resolve`,
    { action: "delete_reply" },
    manager,
  );
  assert.equal(removeRoot.statusCode, 200, removeRoot.body);
  assert.ok(
    (await query("SELECT deleted_at FROM replies WHERE id=$1", [rootId]))
      .rows[0].deleted_at,
  );
  assert.equal(
    (
      await query("SELECT id FROM replies WHERE id=$1", [
        retained.json().reply.id,
      ])
    ).rowCount,
    1,
  );
  for (const payload of [
    { targetType: "post", postId, replyId: rootId },
    { targetType: "reply", postId, replyId: rootId, userUid: author.user.uid },
    { targetType: "user", userUid: author.user.uid, postId },
  ])
    assert.equal(
      (
        await request(
          "POST",
          "/api/reports",
          { ...payload, reason: "混合目标" },
          reporter,
        )
      ).statusCode,
      400,
    );

  const userReport = await request(
    "POST",
    "/api/reports",
    {
      targetType: "user",
      userUid: author.user.uid,
      reason: "请核查该用户",
    },
    reporter,
  );
  assert.equal(userReport.statusCode, 201, userReport.body);
  assert.equal(
    (
      await request(
        "POST",
        `/api/admin/reports/${userReport.json().id}/resolve`,
        { action: "ban", banMinutes: 30 },
        manager,
      )
    ).statusCode,
    200,
  );
  assert.ok(
    (
      await query("SELECT banned_until FROM users WHERE uid=$1", [
        author.user.uid,
      ])
    ).rows[0].banned_until,
  );
  for (let index = 0; index < 21; index++) {
    const suffix = randomUUID().slice(0, 8);
    const blocked = await query(
      "INSERT INTO users(username,email,password_hash,display_name) VALUES($1,$2,$3,$4) RETURNING uid",
      [
        `pagination_${index}_${suffix}`,
        `pagination_${index}_${suffix}@example.test`,
        "test-only",
        `分页用户${index}`,
      ],
    );
    await query(
      "INSERT INTO notification_blocks(user_uid,blocked_uid) VALUES($1,$2)",
      [author.user.uid, blocked.rows[0].uid],
    );
    const notice = await query(
      `INSERT INTO notifications(title,body,kind,sender_uid) VALUES('回复了你','分页测试摘要','reply',$1) RETURNING id`,
      [replyer.user.uid],
    );
    await query(
      "INSERT INTO notification_recipients(notification_id,user_uid) VALUES($1,$2)",
      [notice.rows[0].id, author.user.uid],
    );
  }
  const replyPage = await request(
    "GET",
    "/api/me/notifications?kind=reply&page=1",
    undefined,
    author,
  );
  assert.equal(replyPage.json().notices.length, 20);
  assert.equal(replyPage.json().totalPages, 2);
  const blockPage = await request(
    "GET",
    "/api/me/notification-blocks?page=1",
    undefined,
    author,
  );
  assert.equal(blockPage.json().blocks.length, 20);
  assert.equal(blockPage.json().totalPages, 2);
});
