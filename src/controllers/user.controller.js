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

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    getCurrentUser,
    changeCurrentPassword,
    updateUserDetails
};