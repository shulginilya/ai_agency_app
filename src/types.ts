export type Task = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
};

export type Product = {
  id: number;
  title: string;
  description: string;
  price: number;
  rating: number;
  thumbnail: string;
  category: string;
};
