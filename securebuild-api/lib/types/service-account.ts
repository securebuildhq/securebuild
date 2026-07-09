export interface ServiceAccount {
    id: string;
    name: string;
    createdAt: Date;
    expiresAt: Date | null;
    expiresIn: string | null;
    lastUsedAt: Date | null;
    partialValue: string;
    isSystem: boolean;
}

export interface ServiceAccountWithValue extends ServiceAccount {
    value: string;
}