Based on my examination of the codebase, here's a significantly revised and more accurate README:

---

# 水平ノズル検査成績書システム (Horizontal Nozzle Inspection Report System)

A web-based quality control inspection system for processing and validating horizontal nozzle measurement data. The application parses TXT files containing coordinate measurements, validates them against tolerance specifications, and generates professional inspection reports in PDF format.

## Features

### Core Functionality
- **File Upload & Processing**: Upload TXT files with semicolon-separated coordinate data (X, Y, Z, rotation, diameter, tolerance)
- **Measurement Validation**: Automatically validates measurements against predefined tolerance ranges for labeled checkpoints (A-N, G1-G4)
- **Weight Tracking**: Record and manage weight measurements for each inspection file
- **Data Visualization**: Color-coded table display showing pass/fail status for each measurement point
- **PDF Report Generation**: Create professional inspection reports with Puppeteer in A4 landscape format

### Quality Control Features
- 17 validation checkpoints with specific tolerance ranges
- Visual indicators for out-of-range measurements
- Batch processing for multiple files
- File range selection (e.g., files 1-50) or individual file selection
- Inspector name assignment based on user login

### User Management
- Secure session-based authentication
- Three authorized users: `hinkan`, `naemura`, `iwatsuki`
- Login activity logging with IP address and user agent tracking
- Automatic inspector name assignment

## Tech Stack

- **Frontend**: EJS templates, Bootstrap, vanilla JavaScript
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL (Vercel Postgres)
- **PDF Generation**: Puppeteer
- **File Handling**: Multer
- **Session Management**: express-session
- **Deployment**: Vercel
- **Version Control**: GitHub

## Database Schema

### Tables
1. **files**: Stores uploaded file metadata (id, filename, uploaded_at)
2. **file_data**: Stores parsed measurement data (id, file_id, data_type, index, x, y, z, rot_x, rot_y, rot_z, note, diameter, tolerance)
3. **file_weights**: Stores weight measurements (id, file_id, weight)
4. **login_logs**: Tracks user authentication (id, username, login_time, ip_address, user_agent, status, location)

## Validation Checkpoints

The system validates measurements at 17 labeled checkpoints with the following tolerance ranges:

| Label | Min (mm) | Max (mm) | Description |
|-------|----------|----------|-------------|
| A | 8.0 | 8.4 | Y-axis measurement |
| B | 37.2 | 37.8 | Tolerance measurement |
| C | 15.7 | 16.1 | Y-axis measurement |
| D | 23.9 | 24.3 | Y-axis measurement |
| E | 11.2 | 11.4 | (Not mapped) |
| F | 3.1 | 3.3 | (Not mapped) |
| G1-G4 | 7.8 | 8.2 | Tolerance measurements |
| H | 4.9 | 5.1 | Y-axis measurement |
| I | 29.8 | 30.2 | Tolerance measurement |
| J | 154.9 | 155.9 | Tolerance measurement |
| K | 82.8 | 83.4 | Y-axis measurement |
| L | 121.8 | 122.8 | Tolerance measurement |
| M | - | - | (Not mapped) |
| N | - | - | (Not mapped) |

## Getting Started

### Prerequisites

- Node.js 14.x or higher
- npm or yarn
- PostgreSQL database (Vercel Postgres recommended)
- GitHub account (for version control)
- Vercel account (for deployment)

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kinugasa-hirata/suihei-process.git
   cd suihei-process
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create a `.env` file with your database connection:**
   ```env
   DATABASE_URL=your_postgres_connection_string_here
   PORT=3000
   NODE_ENV=development
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

5. **Access the application:**
   Open your browser and navigate to `http://localhost:3000`

6. **Login credentials:**
   - Username: `hinkan`, `naemura`, or `iwatsuki`
   - Password: Any 4-digit number

## Deployment to Vercel

1. **Push your code to GitHub**
2. **Connect Vercel to your GitHub repository**
3. **Configure environment variables:**
   - Add `DATABASE_URL` in Vercel project settings
4. **Deploy from the Vercel dashboard**

## Project Structure

```
suihei-process/
├── app.js                    # Main application file with routes and logic
├── package.json              # Node.js dependencies and scripts
├── package-lock.json         # Dependency lock file
├── .env                      # Environment variables (not in git)
├── vercel.json              # Vercel deployment configuration
├── public/                   # Static assets
│   ├── favicon.ico          # Application icon
│   ├── android-chrome-*.png # PWA icons
│   └── site.webmanifest     # PWA manifest
├── views/                    # EJS templates
│   ├── index.ejs            # Main dashboard with file list
│   ├── fileData.ejs         # Detailed file data view
│   ├── summary.ejs          # Inspection summary table
│   ├── summary_pdf.ejs      # PDF template for reports
│   ├── login.ejs            # Login page
│   └── error.ejs            # Error page
├── node_modules/            # Dependencies (not in git)
└── README.md                # Project documentation
```

## Usage

### 1. Upload Files
- Login with authorized credentials
- Click "ファイルを選択" (Choose File) to select TXT files
- Choose overwrite action (skip or overwrite existing files)
- Click "アップロード" (Upload)

### 2. Add Weight Data
- Enter weight in grams for each file
- Weights are automatically converted and stored

### 3. Generate Reports
- Select files by range (e.g., 1-50) or individually
- Enter inspector name (defaults to logged-in user's name)
- Click "集計表を表示" (Show Summary) to view in browser
- Click "PDFを保存" (Save PDF) to download inspection report

### 4. View File Details
- Click "表示" (View) next to any file to see detailed coordinate data
- View all measurements with their X, Y, Z coordinates and tolerances

## File Format

The application expects TXT files with semicolon-separated values in the following format:
```
data_type;index;x;y;z;rot_x;rot_y;rot_z;note;diameter;tolerance
```

Example:
```
Point;0;10.5;8.2;15.3;0.0;0.0;0.0;Measurement Point A;5.0;0.05
```

## Security Notes

- All routes (except login) are protected with session-based authentication
- Database connections use SSL in production
- File uploads are limited to 5MB
- Files are stored in memory (not on disk) for processing
- Login attempts are logged with IP addresses

## Development

### Available Scripts

- `npm start`: Start production server
- `npm run dev`: Start development server with nodemon (auto-reload)
- `npm test`: Run tests (currently not implemented)

### Key Dependencies

- **express**: ^4.x - Web framework
- **pg**: ^8.x - PostgreSQL client
- **multer**: ^1.x - File upload handling
- **puppeteer**: ^24.4.0 - PDF generation
- **ejs**: ^3.x - Template engine
- **dotenv**: ^16.x - Environment variable management
- **express-session**: ^1.x - Session management

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` in `.env` file
- Ensure PostgreSQL database is accessible
- Check SSL settings for production vs development

### PDF Generation Failures
- Ensure Puppeteer dependencies are installed
- For Vercel deployment, use serverless-compatible configuration
- Check memory limits in deployment environment

### File Upload Problems
- Verify file size is under 5MB
- Check file format matches expected semicolon-separated values
- Ensure proper file encoding (UTF-8)

## License

MIT License - See LICENSE file for details

## Contributors

- Kinugasa Hirata (Repository Owner)
- Built for quality control inspection workflows in manufacturing

---

**Note**: This system is specifically designed for horizontal nozzle inspection processes and includes Japanese language interface elements for manufacturing quality control operations.
