import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.js";
import {ApiResponse} from "../utils/ApiResponse.js";

const registerUser = asyncHandler(async (req, res) => {
    
    const {fullname, email, username, password} = req.body;
    console.log(email);

    if (
        [fullname, email, username, password].some(( field )=> field?.trim() === "" )
    ){
        throw new ApiError(400, "Fill the required fields!");
    }

    const existedUser = User.findOne( {
        $or: [{email}, {username}],
    } )

    if (existedUser){
        throw new ApiError(409, "user with this username or email already exists!");
    }
    
    const avatarLocalPath = req.files?.avatar[0]?.path;
    const coverImageLocalPath = req.files?.coverImage[0]?.path;
    
    if (!avatarLocalPath){
        throw new ApiError(400, "Avatar is required!");
    }

    const avatarOnCloudinary = await uploadOnCloudinary(avatarLocalPath);
    const coverImageOnCloudinary = await uploadOnCloudinary(coverImageLocalPath);

    if (!avatarOnCloudinary){
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

    if (!createdUser){
        throw new ApiError(500, "Something went wrong while registering user!");
    }

    return res.status(201).json( 
        new ApiResponse(200, createdUser, "User registered successfully")
     )


})

export {registerUser};