import mongoose, { mongo } from "mongoose";

export const connectDB = async (): Promise<void> => {
    try {
        const mongoURI = process.env.MONGODB_URI;

        if (!mongoURI){
            throw new Error('MONGODB_URI is not defined in environnement variable!');
        }
    await mongoose.connect(mongoURI);

    console.log('MongoDB connected succesfull');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};