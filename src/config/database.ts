import mongoose, { mongo } from "mongoose";
import logger from "./logger";

export const connectDB = async (): Promise<void> => {
    try {
        const mongoURI = process.env.MONGODB_URI;

        if (!mongoURI){
            throw new Error('MONGODB_URI is not defined in environnement variable!');
        }
    await mongoose.connect(mongoURI);

    logger.info('MongoDB connected successfully');
    } catch (error) {
        logger.fatal({ err: error }, 'MongoDB connection error');
        process.exit(1);
    }
};
