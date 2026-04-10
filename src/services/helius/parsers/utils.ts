export const formatAddress = (address: string | null) => {
    if (!address) return 'Unknown';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

export const formatDate = (date: Date | string | null): string => {
    if (!date) return 'Unknown';

    const dateObj = typeof date === 'string' ? new Date(date) : date;

    const day = dateObj.getDate().toString().padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[dateObj.getMonth()];

    let hours = dateObj.getHours();
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = hours.toString().padStart(2, '0');

    return `${day} ${month} - ${hoursStr}:${minutes} ${ampm}`;
};

export const getExplorerUrl = (signature: string, cluster: 'devnet' | 'mainnet-beta' = 'devnet'): string => {
    return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
};
