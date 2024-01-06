import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js"
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import Jwt from "jsonwebtoken";


const generateAccessRefereshToken = async function (userID) {
    try {
        const user = await User.findById({ userID });
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        user.refreshToken = refreshToken;
        user.save({ validateBeforeSave: false });

        return {
            accessToken,
            refreshToken
        };

    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating referesh or access token!")
    }
}

const registerUser = asyncHandler(async (req, res) => {

    const { fullname, email, username, password } = req.body;
    console.log(email);

    if (
        [fullname, email, username, password].some((field) => field?.trim() === "")
    ) {
        throw new ApiError(400, "Fill the required fields!");
    }

    const existedUser = User.findOne({
        $or: [{ email }, { username }],
    })

    if (existedUser) {
        throw new ApiError(409, "user with this username or email already exists!");
    }

    const avatarLocalPath = req.files?.avatar[0]?.path;
    const coverImageLocalPath = req.files?.coverImage[0]?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar is required!");
    }

    const avatarOnCloudinary = await uploadOnCloudinary(avatarLocalPath);
    const coverImageOnCloudinary = await uploadOnCloudinary(coverImageLocalPath);

    if (!avatarOnCloudinary) {
        throw new ApiError(400, "Avatar is required!");
    }

    const newUser = await User.create(
        {
            fullname,
            avatar: avatarOnCloudinary.url,
            coverImage: coverImageOnCloudinary?.url || "",
            email,
            password,
            username: username.toLowerCase()
        }
    );

    const createdUser = await User.findById(newUser._id).select(
        "-password -refreshToken",
    );

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering user!");
    }

    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully")
    )


})

const loginUser = asyncHandler(async (req, res) => {
    const { email, username, password } = req.body;

    if (!email && !username) {
        throw new ApiError(400, "username or email is required!");
    }

    const user = await User.findOne({
        $or: [{ username }, { email }]
    })

    if (!user) {
        throw new ApiError(404, "User does not exists!");
    }

    const isPasswordValid = await user.validatePassword(password);

    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user credential!");
    }

    const { accessToken, refreshToken } = await generateAccessRefereshToken(user._id);

    const loggedinUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: true
    };

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200,
                {
                    user: loggedinUser, accessToken, refreshToken
                },
                "User logged in successfully!"
            )
        )

})


const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        })

    const options = {
        httpOnly: true,
        secure: true
    };

    return res.status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(
            200,
            {},
            "User loggedout successfully!"
        ))
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToeken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToeken) {
        return new ApiError(401, "Unauthorizd request!");
    }
    try {

        const decodedToken = Jwt.verify(incomingRefreshToeken, process.env.REFRESH_TOKEN_SECRET);

        const user = await User.findById(decodedToken?._id);

        if (!user) {
            return new ApiError(401, "Invalid refresh token!");
        }

        if (incomingRefreshToeken !== user?.refreshToken) {
            return new ApiError(401, "Refresh token is expired or used!");
        }

        const options = {
            httpOnly: true,
            secure: true,
        }

        const { accessToken, newRefreshToken } = await generateAccessRefereshToken(user._id);

        return res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(
                new ApiResponse(200,
                    { accessToken, newRefreshToken },
                    "Access token refreshed!"
                ))

    } catch (error) {
        return res.status(500)
            .json(
                new ApiResponse(500, {}, error?.message || "Invalid refresh token")
            )
    }

})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const loggedinUser = req.user; // comes from auth middleware
    const user = await User.findById(loggedinUser?._id);
    const isPasswordValid = await user.validatePassword(oldPassword);

    if (!isPasswordValid) {
        throw new ApiError(400, "Invalid old password");
    }

    user.password = newPassword;
    await user.save({ validateBeforeSave: false });

    return res
        .status(200)
        .json(
            new ApiResponse(200, {}, "Password changed successfully!")
        );
});


const getCurrentUser = asyncHandler(async (req, res) => {
    return res
        .status(200)
        .json(
            new ApiResponse(200, req.user, "Current user fetched!")
        );
});

const updateUserDetails = asyncHandler(async (req, res) => {
    const { fullName, email } = req.body;
    const currentUser = req.user;

    const user = await User.findByIdAndUpdate(
        currentUser?._id,
        {
            $set: {
                fullName,
                email
            }
        },

        { new: true }, // returns user with new details

    ).select("-password");

    return res
        .status(200)
        .json(
            new ApiResponse(200, user, "Details updated successfully!")
        );

});

// TODO: delete old ☺ image after updating.
const updateUserAvatar = asyncHandler(async (req, res) => {

    const avatarLocalFilePath = req.file?.path;

    if (!avatarLocalFilePath) {
        throw new ApiError(400, "Avatar file is missing");
    }

    const avatar = await uploadOnCloudinary(avatarLocalFilePath);

    if (!avatar.url) {
        throw new ApiError(400, "Error while uploading avatar");
    }

    const currentUser = req.user;
    const updatedUser = await User.findByIdAndUpdate(currentUser?._id,
        {
            $set: {
                avatar: avatar.url
            }
        }, { new: true });

    return res
        .status(200)
        .json(
            new ApiResponse(200, updatedUser, "Avatar updated successfully!")
        );

});

// TODO: delete old cover image after updating.
const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalFilePath = req.file?.path;

    if (!coverImageLocalFilePath) {
        throw new ApiError(400, "Error while uploading cover image!");
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalFilePath);

    if (!coverImage.url) {
        throw new ApiError(400, "Cover image was not found!");
    }

    const currentUser = req.user;
    const updatedUser = await User.findByIdAndUpdate(currentUser?._id, {
        $set: {
            coverImage: coverImage.url
        }
    }, { new: true }).select("-password");

    return res
        .status(200)
        .json(
            new ApiResponse(200, updatedUser, "Cover Image updated successfully")
        );
});


const getUserChannelProfile = asyncHandler(async (req, res) => {

    const { username } = req.params;
    if (!username?.trim()) {
        throw new ApiError(400, "Username is missing");
    }

    const channelPrfofileDetail = await User.aggregate([
        // Getting channel document
        {
            $match: {
                username: username?.toLowerCase()
            }
        },
        // getting subscriber count of the channel
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        // getting subscribed count of the channel
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo",
            }
        },
        // Adding those extra count fields
        {
            $addFields: {
                subscriberCount: {
                    $size: "$subscribers"
                },
                subscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $condition: {
                        if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                        then: true,
                        else: true,
                    }
                }
            },
        },
        // Projecting what fields to send
        {
            $project: {
                fullName: 1,
                usernaem: 1,
                subscribedToCount: 1,
                subscriberCount: 1,
                avatar: 1,
                coverImage: 1,
                email: 1,
            }
        }
    ]);

    if (!channelPrfofileDetail?.length) {
        throw new ApiError(404, "Channel doesnot exists!");
    }

    return res
        .status(200)
        .json(
            new ApiResponse(200, channelPrfofileDetail[0], "User fetched successfully")
        )

})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    getCurrentUser,
    changeCurrentPassword,
    updateUserDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
};