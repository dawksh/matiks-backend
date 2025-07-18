import { prisma } from "./prisma";

export const handleUserConnect = async (
  fid: string,
  displayName: string,
  profilePictureUrl: string,
  username: string
) => {
  let user = await prisma.user.findFirst({
    where: {
      fid,
    },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        fid,
        displayName,
        profilePictureUrl,
        username,
      },
    });
  }
  return user;
};
