import { prisma } from "./prisma";

export const handleUserConnect = async (
  fid: string,
  displayName: string,
  profilePictureUrl: string,
  username: string
) => {
  const user = await prisma.user.upsert({
      create: {
        fid,
        displayName,
        profilePictureUrl,
        username,
      },
      update: {
        displayName,
        profilePictureUrl,
        username,
      },
      where: { fid },
    });
  return user;
};
