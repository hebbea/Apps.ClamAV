"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyUser = void 0;
const notifyUser = async ({ app, read, modify, room, user, text, attachments, blocks, }) => {
    const appUser = await read.getUserReader().getAppUser(app.getID());
    if (!appUser) {
        throw new Error('user-not-found');
    }
    const msg = modify
        .getCreator()
        .startMessage()
        .setGroupable(false)
        .setSender(appUser)
        .setRoom(room);
    if (text && text.length > 0) {
        msg.setText(text);
    }
    if (attachments && attachments.length > 0) {
        msg.setAttachments(attachments);
    }
    if (blocks !== undefined) {
        msg.setBlocks(blocks);
    }
    return read.getNotifier().notifyUser(user, msg.getMessage());
};
exports.notifyUser = notifyUser;
