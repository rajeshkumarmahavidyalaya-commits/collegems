export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_sessions: {
        Row: {
          created_at: string
          end_date: string
          id: string
          is_current: boolean
          name: string
          start_date: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          is_current?: boolean
          name: string
          start_date: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          is_current?: boolean
          name?: string
          start_date?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_type: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_postable: boolean
          is_system: boolean
          name: string
          parent_id: string | null
          postable_flag: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_postable?: boolean
          is_system?: boolean
          name: string
          parent_id?: string | null
          postable_flag?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_postable?: boolean
          is_system?: boolean
          name?: string
          parent_id?: string | null
          postable_flag?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_parent_fkey"
            columns: ["tenant_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          attendance_date: string
          created_at: string
          enrolment_id: string
          id: string
          marked_by: string | null
          note: string | null
          period: number
          session_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attendance_date: string
          created_at?: string
          enrolment_id: string
          id?: string
          marked_by?: string | null
          note?: string | null
          period?: number
          session_id: string
          status: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attendance_date?: string
          created_at?: string
          enrolment_id?: string
          id?: string
          marked_by?: string | null
          note?: string | null
          period?: number
          session_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_enrolment_id_fkey"
            columns: ["tenant_id", "enrolment_id"]
            isOneToOne: false
            referencedRelation: "enrolments"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          row_id: string
          table_name: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id: string
          table_name: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string
          table_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      book_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      book_issues: {
        Row: {
          book_id: string
          created_at: string
          due_at: string
          fine_amount: number
          id: string
          issued_at: string
          issued_by: string | null
          member_id: string
          returned_at: string | null
          returned_by: string | null
          session_id: string
          staff_fine_payslip_id: string | null
          staff_fine_waived_at: string | null
          staff_fine_waived_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          book_id: string
          created_at?: string
          due_at: string
          fine_amount?: number
          id?: string
          issued_at?: string
          issued_by?: string | null
          member_id: string
          returned_at?: string | null
          returned_by?: string | null
          session_id: string
          staff_fine_payslip_id?: string | null
          staff_fine_waived_at?: string | null
          staff_fine_waived_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          book_id?: string
          created_at?: string
          due_at?: string
          fine_amount?: number
          id?: string
          issued_at?: string
          issued_by?: string | null
          member_id?: string
          returned_at?: string | null
          returned_by?: string | null
          session_id?: string
          staff_fine_payslip_id?: string | null
          staff_fine_waived_at?: string | null
          staff_fine_waived_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_issues_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_issues_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_issues_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_issues_staff_fine_payslip_fkey"
            columns: ["tenant_id", "staff_fine_payslip_id"]
            isOneToOne: false
            referencedRelation: "payslips"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "book_issues_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          author: string
          available_copies: number
          category_id: string | null
          cover_path: string | null
          created_at: string
          edition: string | null
          id: string
          isbn: string | null
          publisher: string | null
          shelf_location: string | null
          tenant_id: string
          title: string
          total_copies: number
          updated_at: string
        }
        Insert: {
          author: string
          available_copies?: number
          category_id?: string | null
          cover_path?: string | null
          created_at?: string
          edition?: string | null
          id?: string
          isbn?: string | null
          publisher?: string | null
          shelf_location?: string | null
          tenant_id: string
          title: string
          total_copies?: number
          updated_at?: string
        }
        Update: {
          author?: string
          available_copies?: number
          category_id?: string | null
          cover_path?: string | null
          created_at?: string
          edition?: string | null
          id?: string
          isbn?: string | null
          publisher?: string | null
          shelf_location?: string | null
          tenant_id?: string
          title?: string
          total_copies?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "books_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "book_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      class_levels: {
        Row: {
          created_at: string
          id: string
          name: string
          sequence: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sequence: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sequence?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_levels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      class_rooms: {
        Row: {
          capacity: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          created_at: string
          id: string
          kind: string
          next_value: number
          prefix: string
          session_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          next_value?: number
          prefix?: string
          session_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          next_value?: number
          prefix?: string
          session_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      enrolments: {
        Row: {
          created_at: string
          enrolled_at: string
          id: string
          roll_number: string | null
          section_id: string
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enrolled_at?: string
          id?: string
          roll_number?: string | null
          section_id: string
          session_id: string
          status?: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enrolled_at?: string
          id?: string
          roll_number?: string | null
          section_id?: string
          session_id?: string
          status?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrolments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrolments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_remarks: {
        Row: {
          authored_by: string | null
          created_at: string
          exam_id: string
          exam_status: string
          id: string
          remark: string
          session_id: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          authored_by?: string | null
          created_at?: string
          exam_id: string
          exam_status?: string
          id?: string
          remark: string
          session_id: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          authored_by?: string | null
          created_at?: string
          exam_id?: string
          exam_status?: string
          id?: string
          remark?: string
          session_id?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_remarks_exam_fkey"
            columns: ["tenant_id", "exam_id", "exam_status"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["tenant_id", "id", "status"]
          },
          {
            foreignKeyName: "exam_remarks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_remarks_student_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "exam_remarks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_results: {
        Row: {
          attendance: Json
          cohort_size: number | null
          created_at: string
          detail: Json
          exam_id: string
          grade: string | null
          grade_point: number | null
          id: string
          max_marks: number
          percentage: number
          published_at: string
          rank_in_cohort: number | null
          result: string
          rules_snapshot: Json
          session_id: string
          student_id: string
          subjects_counted: number
          subjects_failed: number
          tenant_id: string
          total_marks: number
        }
        Insert: {
          attendance?: Json
          cohort_size?: number | null
          created_at?: string
          detail?: Json
          exam_id: string
          grade?: string | null
          grade_point?: number | null
          id?: string
          max_marks: number
          percentage: number
          published_at?: string
          rank_in_cohort?: number | null
          result: string
          rules_snapshot?: Json
          session_id: string
          student_id: string
          subjects_counted?: number
          subjects_failed?: number
          tenant_id: string
          total_marks: number
        }
        Update: {
          attendance?: Json
          cohort_size?: number | null
          created_at?: string
          detail?: Json
          exam_id?: string
          grade?: string | null
          grade_point?: number | null
          id?: string
          max_marks?: number
          percentage?: number
          published_at?: string
          rank_in_cohort?: number | null
          result?: string
          rules_snapshot?: Json
          session_id?: string
          student_id?: string
          subjects_counted?: number
          subjects_failed?: number
          tenant_id?: string
          total_marks?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_results_exam_fkey"
            columns: ["tenant_id", "exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "exam_results_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_results_student_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "exam_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_subjects: {
        Row: {
          created_at: string
          exam_date: string | null
          exam_id: string
          id: string
          is_optional: boolean
          max_marks: number
          pass_marks: number
          section_id: string
          session_id: string
          slot_kind: string
          subject_id: string
          tenant_id: string
          time_slot_id: string | null
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          exam_date?: string | null
          exam_id: string
          id?: string
          is_optional?: boolean
          max_marks: number
          pass_marks?: number
          section_id: string
          session_id: string
          slot_kind?: string
          subject_id: string
          tenant_id: string
          time_slot_id?: string | null
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          exam_date?: string | null
          exam_id?: string
          id?: string
          is_optional?: boolean
          max_marks?: number
          pass_marks?: number
          section_id?: string
          session_id?: string
          slot_kind?: string
          subject_id?: string
          tenant_id?: string
          time_slot_id?: string | null
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_subjects_assignment_fkey"
            columns: ["tenant_id", "session_id", "section_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "section_subjects"
            referencedColumns: [
              "tenant_id",
              "session_id",
              "section_id",
              "subject_id",
            ]
          },
          {
            foreignKeyName: "exam_subjects_exam_fkey"
            columns: ["tenant_id", "exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "exam_subjects_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_subjects_slot_fkey"
            columns: ["tenant_id", "time_slot_id", "slot_kind"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["tenant_id", "id", "kind"]
          },
          {
            foreignKeyName: "exam_subjects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          created_at: string
          ends_on: string | null
          grading_scheme_id: string | null
          id: string
          kind: string
          name: string
          published_at: string | null
          published_by: string | null
          session_id: string
          starts_on: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          grading_scheme_id?: string | null
          id?: string
          kind?: string
          name: string
          published_at?: string | null
          published_by?: string | null
          session_id: string
          starts_on?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          grading_scheme_id?: string | null
          id?: string
          kind?: string
          name?: string
          published_at?: string | null
          published_by?: string | null
          session_id?: string
          starts_on?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_grading_scheme_fkey"
            columns: ["tenant_id", "grading_scheme_id"]
            isOneToOne: false
            referencedRelation: "grading_schemes"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "exams_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_heads: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_heads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structures: {
        Row: {
          amount: number
          class_level_id: string
          created_at: string
          fee_head_id: string
          frequency: string
          id: string
          session_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          class_level_id: string
          created_at?: string
          fee_head_id: string
          frequency?: string
          id?: string
          session_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          class_level_id?: string
          created_at?: string
          fee_head_id?: string
          frequency?: string
          id?: string
          session_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_structures_class_level_id_fkey"
            columns: ["class_level_id"]
            isOneToOne: false
            referencedRelation: "class_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_fee_head_id_fkey"
            columns: ["fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_heads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      grading_schemes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          rules: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          rules?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          rules?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grading_schemes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_student: {
        Row: {
          can_pickup: boolean
          created_at: string
          guardian_id: string
          id: string
          is_primary: boolean
          relationship: string
          student_id: string
          tenant_id: string
        }
        Insert: {
          can_pickup?: boolean
          created_at?: string
          guardian_id: string
          id?: string
          is_primary?: boolean
          relationship: string
          student_id: string
          tenant_id: string
        }
        Update: {
          can_pickup?: boolean
          created_at?: string
          guardian_id?: string
          id?: string
          is_primary?: boolean
          relationship?: string
          student_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_student_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      guardians: {
        Row: {
          created_at: string
          id: string
          occupation: string | null
          person_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          occupation?: string | null
          person_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          occupation?: string | null
          person_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardians_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardians_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          name: string
          note: string | null
          session_id: string
          starts_on: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          name: string
          note?: string | null
          session_id: string
          starts_on: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          name?: string
          note?: string | null
          session_id?: string
          starts_on?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      homework: {
        Row: {
          assigned_by_staff_id: string | null
          assigned_on: string
          collects_submissions: boolean
          created_at: string
          created_by: string | null
          due_on: string
          id: string
          instructions: string | null
          max_marks: number | null
          published_at: string | null
          section_id: string
          session_id: string
          status: string
          subject_id: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_by_staff_id?: string | null
          assigned_on?: string
          collects_submissions?: boolean
          created_at?: string
          created_by?: string | null
          due_on: string
          id?: string
          instructions?: string | null
          max_marks?: number | null
          published_at?: string | null
          section_id: string
          session_id: string
          status?: string
          subject_id: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_by_staff_id?: string | null
          assigned_on?: string
          collects_submissions?: boolean
          created_at?: string
          created_by?: string | null
          due_on?: string
          id?: string
          instructions?: string | null
          max_marks?: number | null
          published_at?: string | null
          section_id?: string
          session_id?: string
          status?: string
          subject_id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignment_fkey"
            columns: ["tenant_id", "session_id", "section_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "section_subjects"
            referencedColumns: [
              "tenant_id",
              "session_id",
              "section_id",
              "subject_id",
            ]
          },
          {
            foreignKeyName: "homework_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_staff_fkey"
            columns: ["tenant_id", "assigned_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "homework_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_files: {
        Row: {
          bucket_id: string
          content_type: string | null
          created_at: string
          file_name: string
          homework_id: string | null
          id: string
          size_bytes: number | null
          storage_path: string
          submission_id: string | null
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          bucket_id: string
          content_type?: string | null
          created_at?: string
          file_name: string
          homework_id?: string | null
          id?: string
          size_bytes?: number | null
          storage_path: string
          submission_id?: string | null
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          bucket_id?: string
          content_type?: string | null
          created_at?: string
          file_name?: string
          homework_id?: string | null
          id?: string
          size_bytes?: number | null
          storage_path?: string
          submission_id?: string | null
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_files_homework_fkey"
            columns: ["tenant_id", "homework_id"]
            isOneToOne: false
            referencedRelation: "homework"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "homework_files_submission_fkey"
            columns: ["tenant_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "homework_submissions"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "homework_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          created_at: string
          feedback: string | null
          graded_at: string | null
          graded_by: string | null
          homework_id: string
          id: string
          marks_obtained: number | null
          max_marks: number | null
          note: string | null
          session_id: string
          status: string
          student_id: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          graded_at?: string | null
          graded_by?: string | null
          homework_id: string
          id?: string
          marks_obtained?: number | null
          max_marks?: number | null
          note?: string | null
          session_id: string
          status?: string
          student_id: string
          submitted_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          feedback?: string | null
          graded_at?: string | null
          graded_by?: string | null
          homework_id?: string
          id?: string
          marks_obtained?: number | null
          max_marks?: number | null
          note?: string | null
          session_id?: string
          status?: string
          student_id?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_homework_fkey"
            columns: ["tenant_id", "homework_id", "max_marks"]
            isOneToOne: false
            referencedRelation: "homework"
            referencedColumns: ["tenant_id", "id", "max_marks"]
          },
          {
            foreignKeyName: "homework_submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_student_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "homework_submissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          guardian_id: string | null
          id: string
          invited_by: string | null
          person_id: string | null
          role_id: string
          staff_id: string | null
          status: string
          student_id: string | null
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          guardian_id?: string | null
          id?: string
          invited_by?: string | null
          person_id?: string | null
          role_id: string
          staff_id?: string | null
          status?: string
          student_id?: string | null
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          guardian_id?: string | null
          id?: string
          invited_by?: string | null
          person_id?: string | null
          role_id?: string
          staff_id?: string | null
          status?: string
          student_id?: string | null
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          amount: number
          created_at: string
          description: string
          fee_head_id: string | null
          id: string
          invoice_id: string
          session_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          fee_head_id?: string | null
          id?: string
          invoice_id: string
          session_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          fee_head_id?: string | null
          id?: string
          invoice_id?: string
          session_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_fee_head_id_fkey"
            columns: ["fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_heads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["tenant_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          due_date: string
          id?: string
          invoice_number: string
          issue_date?: string
          issued_by?: string | null
          notes?: string | null
          session_id: string
          status?: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          due_date?: string
          id?: string
          invoice_number?: string
          issue_date?: string
          issued_by?: string | null
          notes?: string | null
          session_id?: string
          status?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          job_type: string
          payload: Json
          result: Json | null
          started_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          job_type: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          job_type?: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_vouchers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          narration: string | null
          posted_at: string | null
          posted_by: string | null
          reverses_voucher_id: string | null
          session_id: string
          source_id: string | null
          source_kind: string
          status: string
          tenant_id: string
          updated_at: string
          voucher_date: string
          voucher_number: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          narration?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reverses_voucher_id?: string | null
          session_id: string
          source_id?: string | null
          source_kind?: string
          status?: string
          tenant_id: string
          updated_at?: string
          voucher_date?: string
          voucher_number?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          narration?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reverses_voucher_id?: string | null
          session_id?: string
          source_id?: string | null
          source_kind?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          voucher_date?: string
          voucher_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_vouchers_reverses_voucher_id_fkey"
            columns: ["reverses_voucher_id"]
            isOneToOne: false
            referencedRelation: "journal_vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_vouchers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          ends_on: string
          half_day_end: boolean
          half_day_start: boolean
          id: string
          leave_type_id: string
          reason: string | null
          session_id: string
          staff_id: string
          starts_on: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          ends_on: string
          half_day_end?: boolean
          half_day_start?: boolean
          id?: string
          leave_type_id: string
          reason?: string | null
          session_id: string
          staff_id: string
          starts_on: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          ends_on?: string
          half_day_end?: boolean
          half_day_start?: boolean
          id?: string
          leave_type_id?: string
          reason?: string | null
          session_id?: string
          staff_id?: string
          starts_on?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_staff_fkey"
            columns: ["tenant_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "leave_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_type_fkey"
            columns: ["tenant_id", "leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      leave_types: {
        Row: {
          allows_half_day: boolean
          annual_quota_days: number | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_paid: boolean
          name: string
          requires_approval: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allows_half_day?: boolean
          annual_quota_days?: number | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_paid?: boolean
          name: string
          requires_approval?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allows_half_day?: boolean
          annual_quota_days?: number | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_paid?: boolean
          name?: string
          requires_approval?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          book_issue_id?: string | null
          created_at?: string
          entry_type: string
          id?: string
          invoice_id?: string | null
          method?: string | null
          note?: string | null
          occurred_at?: string
          provider?: string | null
          provider_event_id?: string | null
          receipt_number?: string | null
          recorded_by?: string | null
          reference?: string | null
          reverses_entry_id?: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          book_issue_id?: string | null
          created_at?: string
          entry_type?: string
          id?: string
          invoice_id?: string | null
          method?: string | null
          note?: string | null
          occurred_at?: string
          provider?: string | null
          provider_event_id?: string | null
          receipt_number?: string | null
          recorded_by?: string | null
          reference?: string | null
          reverses_entry_id?: string | null
          session_id?: string
          student_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_book_issue_id_fkey"
            columns: ["tenant_id", "book_issue_id"]
            isOneToOne: false
            referencedRelation: "book_issues"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "ledger_entries_invoice_id_fkey"
            columns: ["tenant_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "ledger_entries_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_student_id_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "ledger_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marks: {
        Row: {
          created_at: string
          entered_by: string | null
          exam_subject_id: string
          id: string
          is_absent: boolean
          marks_obtained: number | null
          max_marks: number
          remarks: string | null
          session_id: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entered_by?: string | null
          exam_subject_id: string
          id?: string
          is_absent?: boolean
          marks_obtained?: number | null
          max_marks: number
          remarks?: string | null
          session_id: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entered_by?: string | null
          exam_subject_id?: string
          id?: string
          is_absent?: boolean
          marks_obtained?: number | null
          max_marks?: number
          remarks?: string | null
          session_id?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marks_exam_subject_fkey"
            columns: ["tenant_id", "exam_subject_id", "max_marks"]
            isOneToOne: false
            referencedRelation: "exam_subjects"
            referencedColumns: ["tenant_id", "id", "max_marks"]
          },
          {
            foreignKeyName: "marks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marks_student_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "marks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          max_books: number
          membership_number: string
          staff_id: string | null
          status: string
          student_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          max_books?: number
          membership_number: string
          staff_id?: string | null
          status?: string
          student_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          max_books?: number
          membership_number?: string
          staff_id?: string | null
          status?: string
          student_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          address: string | null
          attempts: number
          body: string
          channel: string
          created_at: string
          id: string
          last_error: string | null
          next_attempt_at: string
          notification_id: string
          read_at: string | null
          recipient_user_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          tenant_id: string
        }
        Insert: {
          address?: string | null
          attempts?: number
          body: string
          channel: string
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id: string
          read_at?: string | null
          recipient_user_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          tenant_id: string
        }
        Update: {
          address?: string | null
          attempts?: number
          body?: string
          channel?: string
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id?: string
          read_at?: string | null
          recipient_user_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["tenant_id", "notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "notification_deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          event_key: string
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          event_key: string
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          event_key?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          event_key: string
          id: string
          is_active: boolean
          subject: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          event_key: string
          id?: string
          is_active?: boolean
          subject?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          event_key?: string
          id?: string
          is_active?: boolean
          subject?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          audience: Json
          body: string
          created_at: string
          created_by: string | null
          event_key: string
          id: string
          payload: Json
          session_id: string
          subject: string | null
          tenant_id: string
        }
        Insert: {
          audience?: Json
          body: string
          created_at?: string
          created_by?: string | null
          event_key: string
          id?: string
          payload?: Json
          session_id: string
          subject?: string | null
          tenant_id: string
        }
        Update: {
          audience?: Json
          body?: string
          created_at?: string
          created_by?: string | null
          event_key?: string
          id?: string
          payload?: Json
          session_id?: string
          subject?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          expires_at: string | null
          failure_reason: string | null
          id: string
          invoice_id: string | null
          ledger_entry_id: string | null
          payment_url: string | null
          provider: string
          provider_order_id: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          invoice_id?: string | null
          ledger_entry_id?: string | null
          payment_url?: string | null
          provider?: string
          provider_order_id?: string | null
          session_id: string
          status?: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          invoice_id?: string | null
          ledger_entry_id?: string | null
          payment_url?: string | null
          provider?: string
          provider_order_id?: string | null
          session_id?: string
          status?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_invoice_id_fkey"
            columns: ["tenant_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "payment_intents_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_student_id_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "payment_intents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          note: string | null
          paid_on: string
          payslip_id: string
          payslip_status: string
          recorded_by: string | null
          reference: string | null
          reverses_payment_id: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method: string
          note?: string | null
          paid_on?: string
          payslip_id: string
          payslip_status: string
          recorded_by?: string | null
          reference?: string | null
          reverses_payment_id?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          paid_on?: string
          payslip_id?: string
          payslip_status?: string
          recorded_by?: string | null
          reference?: string | null
          reverses_payment_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payments_payslip_fkey"
            columns: ["tenant_id", "payslip_id", "payslip_status"]
            isOneToOne: false
            referencedRelation: "payslips"
            referencedColumns: ["tenant_id", "id", "run_status"]
          },
          {
            foreignKeyName: "payroll_payments_reverses_payment_id_fkey"
            columns: ["reverses_payment_id"]
            isOneToOne: false
            referencedRelation: "payroll_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          created_at: string
          created_by: string | null
          finalised_at: string | null
          finalised_by: string | null
          id: string
          note: string | null
          period_month: string
          rules_snapshot: Json
          run_kind: string
          session_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          finalised_at?: string | null
          finalised_by?: string | null
          id?: string
          note?: string | null
          period_month: string
          rules_snapshot?: Json
          run_kind?: string
          session_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          finalised_at?: string | null
          finalised_by?: string | null
          id?: string
          note?: string | null
          period_month?: string
          rules_snapshot?: Json
          run_kind?: string
          session_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payslip_lines: {
        Row: {
          amount: number
          basis: string | null
          code: string
          created_at: string
          id: string
          kind: string
          name: string
          payslip_id: string
          payslip_status: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          amount: number
          basis?: string | null
          code: string
          created_at?: string
          id?: string
          kind: string
          name: string
          payslip_id: string
          payslip_status: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          amount?: number
          basis?: string | null
          code?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          payslip_id?: string
          payslip_status?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payslip_lines_payslip_fkey"
            columns: ["tenant_id", "payslip_id", "payslip_status"]
            isOneToOne: false
            referencedRelation: "payslips"
            referencedColumns: ["tenant_id", "id", "run_status"]
          },
          {
            foreignKeyName: "payslip_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          computed: Json
          created_at: string
          employed_days: number
          gross_earnings: number
          id: string
          is_override: boolean
          lop_days: number
          net_pay: number
          note: string | null
          paid_days: number
          run_id: string
          run_status: string
          staff_id: string
          tenant_id: string
          total_deductions: number
          updated_at: string
          working_days: number
        }
        Insert: {
          computed?: Json
          created_at?: string
          employed_days?: number
          gross_earnings?: number
          id?: string
          is_override?: boolean
          lop_days?: number
          net_pay?: number
          note?: string | null
          paid_days?: number
          run_id: string
          run_status: string
          staff_id: string
          tenant_id: string
          total_deductions?: number
          updated_at?: string
          working_days?: number
        }
        Update: {
          computed?: Json
          created_at?: string
          employed_days?: number
          gross_earnings?: number
          id?: string
          is_override?: boolean
          lop_days?: number
          net_pay?: number
          note?: string | null
          paid_days?: number
          run_id?: string
          run_status?: string
          staff_id?: string
          tenant_id?: string
          total_deductions?: number
          updated_at?: string
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "payslips_run_fkey"
            columns: ["tenant_id", "run_id", "run_status"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["tenant_id", "id", "status"]
          },
          {
            foreignKeyName: "payslips_staff_fkey"
            columns: ["tenant_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "payslips_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          blood_group: string | null
          city: string | null
          country: string
          created_at: string
          date_of_birth: string | null
          email: string | null
          first_name: string
          gender: string | null
          id: string
          last_name: string
          middle_name: string | null
          phone: string | null
          photo_path: string | null
          postal_code: string | null
          state: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          blood_group?: string | null
          city?: string | null
          country?: string
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name: string
          gender?: string | null
          id?: string
          last_name: string
          middle_name?: string | null
          phone?: string | null
          photo_path?: string | null
          postal_code?: string | null
          state?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          blood_group?: string | null
          city?: string | null
          country?: string
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string
          gender?: string | null
          id?: string
          last_name?: string
          middle_name?: string | null
          phone?: string | null
          photo_path?: string | null
          postal_code?: string | null
          state?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      posting_rules: {
        Row: {
          account_postable: boolean
          created_at: string
          credit_account_id: string
          debit_account_id: string
          event_key: string
          id: string
          is_active: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_postable?: boolean
          created_at?: string
          credit_account_id: string
          debit_account_id: string
          event_key: string
          id?: string
          is_active?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_postable?: boolean
          created_at?: string
          credit_account_id?: string
          debit_account_id?: string
          event_key?: string
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posting_rules_credit_fkey"
            columns: ["tenant_id", "credit_account_id", "account_postable"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["tenant_id", "id", "postable_flag"]
          },
          {
            foreignKeyName: "posting_rules_debit_fkey"
            columns: ["tenant_id", "debit_account_id", "account_postable"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["tenant_id", "id", "postable_flag"]
          },
          {
            foreignKeyName: "posting_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_decisions: {
        Row: {
          applied_enrolment_id: string | null
          carry_forward: number
          created_at: string
          decision: string
          from_enrolment_id: string
          id: string
          is_override: boolean
          reason: string
          run_id: string
          student_id: string
          tenant_id: string
          to_section_id: string | null
          updated_at: string
        }
        Insert: {
          applied_enrolment_id?: string | null
          carry_forward?: number
          created_at?: string
          decision: string
          from_enrolment_id: string
          id?: string
          is_override?: boolean
          reason: string
          run_id: string
          student_id: string
          tenant_id: string
          to_section_id?: string | null
          updated_at?: string
        }
        Update: {
          applied_enrolment_id?: string | null
          carry_forward?: number
          created_at?: string
          decision?: string
          from_enrolment_id?: string
          id?: string
          is_override?: boolean
          reason?: string
          run_id?: string
          student_id?: string
          tenant_id?: string
          to_section_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_decisions_applied_enrolment_id_fkey"
            columns: ["applied_enrolment_id"]
            isOneToOne: false
            referencedRelation: "enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_decisions_from_enrolment_id_fkey"
            columns: ["from_enrolment_id"]
            isOneToOne: false
            referencedRelation: "enrolments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_decisions_run_fkey"
            columns: ["tenant_id", "run_id"]
            isOneToOne: false
            referencedRelation: "promotion_runs"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "promotion_decisions_section_fkey"
            columns: ["tenant_id", "to_section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "promotion_decisions_student_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "promotion_decisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_runs: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          created_at: string
          created_by: string | null
          from_session_id: string
          id: string
          rules: Json
          status: string
          tenant_id: string
          to_session_id: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          created_by?: string | null
          from_session_id: string
          id?: string
          rules?: Json
          status?: string
          tenant_id: string
          to_session_id: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          created_by?: string | null
          from_session_id?: string
          id?: string
          rules?: Json
          status?: string
          tenant_id?: string
          to_session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_runs_from_session_id_fkey"
            columns: ["from_session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_runs_to_session_id_fkey"
            columns: ["to_session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          permission_code: string
          role_id: string
          tenant_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_code: string
          role_id: string
          tenant_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_code?: string
          role_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          tenant_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          tenant_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      route_stops: {
        Row: {
          created_at: string
          drop_time: string | null
          id: string
          landmark: string | null
          monthly_fare: number
          name: string
          pickup_time: string | null
          route_id: string
          sequence: number
          session_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          drop_time?: string | null
          id?: string
          landmark?: string | null
          monthly_fare?: number
          name: string
          pickup_time?: string | null
          route_id: string
          sequence: number
          session_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          drop_time?: string | null
          id?: string
          landmark?: string | null
          monthly_fare?: number
          name?: string
          pickup_time?: string | null
          route_id?: string
          sequence?: number
          session_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_stops_route_fkey"
            columns: ["tenant_id", "route_id", "session_id"]
            isOneToOne: false
            referencedRelation: "transport_routes"
            referencedColumns: ["tenant_id", "id", "session_id"]
          },
          {
            foreignKeyName: "route_stops_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_structures: {
        Row: {
          components: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          components?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          components?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_structures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      section_subjects: {
        Row: {
          created_at: string
          id: string
          section_id: string
          session_id: string
          subject_id: string
          teacher_staff_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          section_id: string
          session_id: string
          subject_id: string
          teacher_staff_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          section_id?: string
          session_id?: string
          subject_id?: string
          teacher_staff_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_subjects_section_id_fkey"
            columns: ["tenant_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "section_subjects_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_subjects_subject_id_fkey"
            columns: ["tenant_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "section_subjects_teacher_fkey"
            columns: ["tenant_id", "teacher_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "section_subjects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          capacity: number
          class_level_id: string
          class_teacher_staff_id: string | null
          created_at: string
          id: string
          name: string
          session_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          class_level_id: string
          class_teacher_staff_id?: string | null
          created_at?: string
          id?: string
          name: string
          session_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          class_level_id?: string
          class_teacher_staff_id?: string | null
          created_at?: string
          id?: string
          name?: string
          session_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_class_level_id_fkey"
            columns: ["class_level_id"]
            isOneToOne: false
            referencedRelation: "class_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_class_teacher_staff_id_fkey"
            columns: ["class_teacher_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          id: string
          key: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          id?: string
          key?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          date_of_joining: string
          date_of_leaving: string | null
          department: string | null
          designation: string
          employee_code: string
          id: string
          person_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_joining?: string
          date_of_leaving?: string | null
          department?: string | null
          designation: string
          employee_code: string
          id?: string
          person_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_joining?: string
          date_of_leaving?: string | null
          department?: string | null
          designation?: string
          employee_code?: string
          id?: string
          person_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance: {
        Row: {
          attendance_date: string
          check_in: string | null
          check_out: string | null
          created_at: string
          id: string
          leave_request_id: string | null
          marked_by: string | null
          note: string | null
          session_id: string
          staff_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attendance_date: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          id?: string
          leave_request_id?: string | null
          marked_by?: string | null
          note?: string | null
          session_id: string
          staff_id: string
          status: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attendance_date?: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          id?: string
          leave_request_id?: string | null
          marked_by?: string | null
          note?: string | null
          session_id?: string
          staff_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_leave_fkey"
            columns: ["tenant_id", "leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "staff_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_staff_fkey"
            columns: ["tenant_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "staff_attendance_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_salary_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          note: string | null
          overrides: Json
          staff_id: string
          structure_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          note?: string | null
          overrides?: Json
          staff_id: string
          structure_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          note?: string | null
          overrides?: Json
          staff_id?: string
          structure_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_salary_assignments_staff_fkey"
            columns: ["tenant_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "staff_salary_assignments_structure_fkey"
            columns: ["tenant_id", "structure_id"]
            isOneToOne: false
            referencedRelation: "salary_structures"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "staff_salary_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          admission_date: string
          admission_number: string
          created_at: string
          id: string
          person_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          admission_date?: string
          admission_number: string
          created_at?: string
          id?: string
          person_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          admission_date?: string
          admission_number?: string
          created_at?: string
          id?: string
          person_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      study_material: {
        Row: {
          bucket_id: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          description: string | null
          external_url: string | null
          file_name: string | null
          id: string
          is_published: boolean
          kind: string
          section_id: string | null
          session_id: string
          size_bytes: number | null
          storage_path: string | null
          subject_id: string | null
          tenant_id: string
          title: string
          updated_at: string
          uploaded_by_staff_id: string | null
        }
        Insert: {
          bucket_id?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          file_name?: string | null
          id?: string
          is_published?: boolean
          kind?: string
          section_id?: string | null
          session_id: string
          size_bytes?: number | null
          storage_path?: string | null
          subject_id?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          uploaded_by_staff_id?: string | null
        }
        Update: {
          bucket_id?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          file_name?: string | null
          id?: string
          is_published?: boolean
          kind?: string
          section_id?: string | null
          session_id?: string
          size_bytes?: number | null
          storage_path?: string | null
          subject_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          uploaded_by_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "study_material_section_fkey"
            columns: ["tenant_id", "section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "study_material_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_material_staff_fkey"
            columns: ["tenant_id", "uploaded_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "study_material_subject_fkey"
            columns: ["tenant_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "study_material_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      time_slots: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          is_break: boolean
          kind: string
          label: string | null
          period_number: number
          schedulable: boolean | null
          starts_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          is_break?: boolean
          kind?: string
          label?: string | null
          period_number: number
          schedulable?: boolean | null
          starts_at: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          is_break?: boolean
          kind?: string
          label?: string | null
          period_number?: number
          schedulable?: boolean | null
          starts_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_slots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_entries: {
        Row: {
          class_room_id: string | null
          created_at: string
          id: string
          note: string | null
          section_id: string
          session_id: string
          slot_schedulable: boolean
          subject_id: string
          teacher_staff_id: string | null
          tenant_id: string
          time_slot_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          class_room_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          section_id: string
          session_id: string
          slot_schedulable?: boolean
          subject_id: string
          teacher_staff_id?: string | null
          tenant_id: string
          time_slot_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          class_room_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          section_id?: string
          session_id?: string
          slot_schedulable?: boolean
          subject_id?: string
          teacher_staff_id?: string | null
          tenant_id?: string
          time_slot_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "timetable_entries_assignment_fkey"
            columns: ["tenant_id", "session_id", "section_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "section_subjects"
            referencedColumns: [
              "tenant_id",
              "session_id",
              "section_id",
              "subject_id",
            ]
          },
          {
            foreignKeyName: "timetable_entries_room_fkey"
            columns: ["tenant_id", "class_room_id"]
            isOneToOne: false
            referencedRelation: "class_rooms"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "timetable_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_entries_slot_fkey"
            columns: ["tenant_id", "time_slot_id", "slot_schedulable"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["tenant_id", "id", "schedulable"]
          },
          {
            foreignKeyName: "timetable_entries_teacher_fkey"
            columns: ["tenant_id", "teacher_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "timetable_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_assignments: {
        Row: {
          created_at: string
          direction: string
          ends_on: string | null
          id: string
          monthly_fare: number
          note: string | null
          route_direction: string
          route_id: string
          session_id: string
          starts_on: string
          status: string
          stop_id: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          direction?: string
          ends_on?: string | null
          id?: string
          monthly_fare: number
          note?: string | null
          route_direction?: string
          route_id: string
          session_id: string
          starts_on: string
          status?: string
          stop_id: string
          student_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          direction?: string
          ends_on?: string | null
          id?: string
          monthly_fare?: number
          note?: string | null
          route_direction?: string
          route_id?: string
          session_id?: string
          starts_on?: string
          status?: string
          stop_id?: string
          student_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_assignments_route_direction_fkey"
            columns: ["tenant_id", "route_id", "route_direction"]
            isOneToOne: false
            referencedRelation: "transport_routes"
            referencedColumns: ["tenant_id", "id", "direction"]
          },
          {
            foreignKeyName: "transport_assignments_route_fkey"
            columns: ["tenant_id", "route_id", "session_id"]
            isOneToOne: false
            referencedRelation: "transport_routes"
            referencedColumns: ["tenant_id", "id", "session_id"]
          },
          {
            foreignKeyName: "transport_assignments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_assignments_stop_on_route_fkey"
            columns: ["tenant_id", "stop_id", "route_id"]
            isOneToOne: false
            referencedRelation: "route_stops"
            referencedColumns: ["tenant_id", "id", "route_id"]
          },
          {
            foreignKeyName: "transport_assignments_student_fkey"
            columns: ["tenant_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "transport_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_routes: {
        Row: {
          code: string
          created_at: string
          direction: string
          fee_head_id: string | null
          id: string
          is_active: boolean
          name: string
          session_id: string
          tenant_id: string
          updated_at: string
          vehicle_capacity: number | null
          vehicle_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          direction?: string
          fee_head_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          session_id: string
          tenant_id: string
          updated_at?: string
          vehicle_capacity?: number | null
          vehicle_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          direction?: string
          fee_head_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          session_id?: string
          tenant_id?: string
          updated_at?: string
          vehicle_capacity?: number | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transport_routes_fee_head_fkey"
            columns: ["tenant_id", "fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_heads"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "transport_routes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "academic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_routes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_routes_vehicle_fkey"
            columns: ["tenant_id", "vehicle_id", "vehicle_capacity"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["tenant_id", "id", "capacity"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          guardian_id: string | null
          id: string
          is_active: boolean
          person_id: string | null
          role_id: string
          staff_id: string | null
          student_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          guardian_id?: string | null
          id: string
          is_active?: boolean
          person_id?: string | null
          role_id: string
          staff_id?: string | null
          student_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          guardian_id?: string | null
          id?: string
          is_active?: boolean
          person_id?: string | null
          role_id?: string
          staff_id?: string | null
          student_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          attendant_staff_id: string | null
          capacity: number
          created_at: string
          driver_staff_id: string | null
          id: string
          is_active: boolean
          model: string | null
          notes: string | null
          registration_number: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attendant_staff_id?: string | null
          capacity: number
          created_at?: string
          driver_staff_id?: string | null
          id?: string
          is_active?: boolean
          model?: string | null
          notes?: string | null
          registration_number: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attendant_staff_id?: string | null
          capacity?: number
          created_at?: string
          driver_staff_id?: string | null
          id?: string
          is_active?: boolean
          model?: string | null
          notes?: string | null
          registration_number?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_attendant_fkey"
            columns: ["tenant_id", "attendant_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "vehicles_driver_fkey"
            columns: ["tenant_id", "driver_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_lines: {
        Row: {
          account_id: string
          account_postable: boolean
          account_type: string
          created_at: string
          credit: number
          debit: number
          id: string
          narration: string | null
          sort_order: number
          tenant_id: string
          voucher_id: string
          voucher_status: string
        }
        Insert: {
          account_id: string
          account_postable?: boolean
          account_type: string
          created_at?: string
          credit?: number
          debit?: number
          id?: string
          narration?: string | null
          sort_order?: number
          tenant_id: string
          voucher_id: string
          voucher_status: string
        }
        Update: {
          account_id?: string
          account_postable?: boolean
          account_type?: string
          created_at?: string
          credit?: number
          debit?: number
          id?: string
          narration?: string | null
          sort_order?: number
          tenant_id?: string
          voucher_id?: string
          voucher_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_lines_account_postable_fkey"
            columns: ["tenant_id", "account_id", "account_postable"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["tenant_id", "id", "postable_flag"]
          },
          {
            foreignKeyName: "voucher_lines_account_type_fkey"
            columns: ["tenant_id", "account_id", "account_type"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["tenant_id", "id", "account_type"]
          },
          {
            foreignKeyName: "voucher_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_lines_voucher_fkey"
            columns: ["tenant_id", "voucher_id", "voucher_status"]
            isOneToOne: false
            referencedRelation: "journal_vouchers"
            referencedColumns: ["tenant_id", "id", "status"]
          },
        ]
      }
      weekends: {
        Row: {
          created_at: string
          id: string
          is_teaching: boolean
          tenant_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_teaching?: boolean
          tenant_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          id?: string
          is_teaching?: boolean
          tenant_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekends_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      academics_is_teaching_day: { Args: { p_date: string }; Returns: boolean }
      academics_roll_forward_sections: {
        Args: { p_from_session_id: string; p_to_session_id: string }
        Returns: number
      }
      accounts_chart_balances: {
        Args: { p_as_of?: string }
        Returns: {
          account_type: string
          balance: number
          code: string
          depth: number
          id: string
          is_active: boolean
          is_postable: boolean
          name: string
          parent_id: string
        }[]
      }
      accounts_delete_draft: {
        Args: { p_voucher_id: string }
        Returns: undefined
      }
      accounts_ledger: {
        Args: { p_account_id: string; p_from?: string; p_to?: string }
        Returns: {
          credit: number
          debit: number
          is_opening: boolean
          line_narration: string
          narration: string
          running_balance: number
          voucher_date: string
          voucher_id: string
          voucher_number: string
        }[]
      }
      accounts_next_voucher_number: { Args: never; Returns: string }
      accounts_post_voucher: { Args: { p_voucher_id: string }; Returns: string }
      accounts_reverse_voucher: {
        Args: { p_date?: string; p_narration?: string; p_voucher_id: string }
        Returns: string
      }
      accounts_seed_default_chart: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      accounts_sync: {
        Args: { p_limit?: number }
        Returns: {
          created: number
          remaining: number
        }[]
      }
      accounts_trial_balance: {
        Args: { p_as_of?: string }
        Returns: {
          account_id: string
          account_type: string
          code: string
          credit: number
          debit: number
          name: string
        }[]
      }
      admit_student: {
        Args: {
          p_admission_date?: string
          p_admission_number: string
          p_person: Json
          p_roll_number?: string
          p_section_id?: string
        }
        Returns: {
          admission_date: string
          admission_number: string
          created_at: string
          id: string
          person_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "students"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_role_allows: {
        Args: { p_permission_code: string }
        Returns: boolean
      }
      current_role_code: { Args: never; Returns: string }
      current_session_id: { Args: { p_tenant_id: string }; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      exams_attendance_summary: {
        Args: { p_session_id: string; p_student_id: string; p_upto?: string }
        Returns: {
          days_absent: number
          days_excused: number
          days_late: number
          days_marked: number
          days_present: number
        }[]
      }
      exams_enter_marks: {
        Args: { p_entries: Json; p_exam_subject_id: string }
        Returns: number
      }
      exams_mark_sheet: {
        Args: { p_exam_subject_id: string }
        Returns: {
          admission_number: string
          is_absent: boolean
          marks_obtained: number
          remarks: string
          roll_number: string
          student_id: string
          student_name: string
        }[]
      }
      exams_may_see_student: {
        Args: { p_student_id: string }
        Returns: boolean
      }
      exams_publish: { Args: { p_exam_id: string }; Returns: number }
      exams_published_for_student: {
        Args: { p_student_id: string }
        Returns: {
          cohort_size: number
          ends_on: string
          exam_id: string
          exam_name: string
          grade: string
          kind: string
          percentage: number
          published_at: string
          rank_in_cohort: number
          result: string
        }[]
      }
      exams_ranking: {
        Args: { p_exam_id: string }
        Returns: {
          cohort_size: number
          rank_in_cohort: number
          student_id: string
        }[]
      }
      exams_remark_sheet: {
        Args: { p_exam_id: string; p_section_id: string }
        Returns: {
          admission_number: string
          remark: string
          roll_number: string
          student_id: string
          student_name: string
          updated_at: string
        }[]
      }
      exams_report_card: {
        Args: { p_exam_id: string; p_student_id: string }
        Returns: Json
      }
      exams_report_cards: {
        Args: {
          p_exam_id: string
          p_section_id?: string
          p_student_id?: string
        }
        Returns: Json[]
      }
      exams_result_sheet: {
        Args: { p_exam_id: string; p_section_id?: string }
        Returns: {
          admission_number: string
          detail: Json
          grade: string
          grade_point: number
          max_marks: number
          percentage: number
          result: string
          roll_number: string
          section_label: string
          student_id: string
          student_name: string
          subjects_counted: number
          subjects_failed: number
          subjects_unmarked: number
          total_marks: number
        }[]
      }
      exams_rules_for: { Args: { p_exam_id: string }; Returns: Json }
      exams_set_remark: {
        Args: { p_exam_id: string; p_remark: string; p_student_id: string }
        Returns: string
      }
      exams_subject_breakdown: {
        Args: { p_exam_id: string; p_student_id?: string }
        Returns: {
          counted: boolean
          effective_marks: number
          entered: boolean
          exam_subject_id: string
          grace_marks: number
          is_absent: boolean
          is_optional: boolean
          marks_obtained: number
          max_marks: number
          note: string
          pass_marks: number
          passed: boolean
          percentage: number
          student_id: string
          subject_code: string
          subject_id: string
          subject_name: string
          weight: number
        }[]
      }
      exams_unpublish: { Args: { p_exam_id: string }; Returns: number }
      fees_billable_lines: {
        Args: {
          p_as_of?: string
          p_fee_head_ids?: string[]
          p_student_id: string
        }
        Returns: {
          amount: number
          description: string
          fee_head_id: string
          source: string
        }[]
      }
      fees_cancel_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_create_payment_intent: {
        Args: { p_amount: number; p_invoice_id?: string; p_student_id: string }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          expires_at: string | null
          failure_reason: string | null
          id: string
          invoice_id: string | null
          ledger_entry_id: string | null
          payment_url: string | null
          provider: string
          provider_order_id: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_intents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_day_book: {
        Args: { p_from: string; p_to: string }
        Returns: {
          admission_number: string
          amount: number
          entry_type: string
          id: string
          is_reversal: boolean
          is_reversed: boolean
          method: string
          note: string
          occurred_at: string
          receipt_number: string
          reference: string
          student_id: string
          student_name: string
        }[]
      }
      fees_generate_invoice: {
        Args: {
          p_due_date: string
          p_fee_head_ids?: string[]
          p_notes?: string
          p_student_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_generate_section_invoices: {
        Args: {
          p_due_date: string
          p_fee_head_ids?: string[]
          p_section_id: string
        }
        Returns: number
      }
      fees_next_document_number: { Args: { p_kind: string }; Returns: string }
      fees_next_document_number_for: {
        Args: { p_kind: string; p_session_id: string; p_tenant_id: string }
        Returns: string
      }
      fees_queue_invoice_email: {
        Args: { p_invoice_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          job_type: string
          payload: Json
          result: Json | null
          started_at: string | null
          status: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_raise_charge: {
        Args: {
          p_amount: number
          p_description: string
          p_due_date: string
          p_fee_head_id?: string
          p_student_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          issued_by: string | null
          notes: string | null
          session_id: string
          status: string
          student_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_record_adjustment: {
        Args: {
          p_amount: number
          p_entry_type: string
          p_invoice_id?: string
          p_note: string
          p_student_id: string
        }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_record_payment: {
        Args: {
          p_amount: number
          p_invoice_id?: string
          p_method: string
          p_note?: string
          p_occurred_at?: string
          p_provider?: string
          p_provider_event_id?: string
          p_reference?: string
          p_student_id: string
        }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_record_refund: {
        Args: {
          p_amount: number
          p_method: string
          p_note?: string
          p_occurred_at?: string
          p_reference?: string
          p_student_id: string
        }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_reverse_entry: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_settle_gateway_payment: {
        Args: {
          p_amount: number
          p_method?: string
          p_provider: string
          p_provider_event_id: string
          p_provider_order_id: string
          p_reference?: string
        }
        Returns: {
          amount: number
          book_issue_id: string | null
          created_at: string
          entry_type: string
          id: string
          invoice_id: string | null
          method: string | null
          note: string | null
          occurred_at: string
          provider: string | null
          provider_event_id: string | null
          receipt_number: string | null
          recorded_by: string | null
          reference: string | null
          reverses_entry_id: string | null
          session_id: string
          student_id: string
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ledger_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_student_balances: {
        Args: {
          p_only_outstanding?: boolean
          p_section_id?: string
          p_student_ids?: string[]
        }
        Returns: {
          admission_number: string
          balance: number
          charged: number
          discounts: number
          fines: number
          full_name: string
          last_payment_at: string
          paid: number
          refunds: number
          roll_number: string
          section_label: string
          student_id: string
          write_offs: number
        }[]
      }
      grading_grade_for: {
        Args: { p_percentage: number; p_rules: Json }
        Returns: {
          code: string
          description: string
          is_fail: boolean
          point: number
        }[]
      }
      grading_scheme_problems: {
        Args: { p_rules: Json }
        Returns: {
          problem: string
        }[]
      }
      homework_for_student: {
        Args: { p_include_done?: boolean; p_student_id?: string }
        Returns: {
          assigned_on: string
          attachment_count: number
          collects_submissions: boolean
          due_on: string
          feedback: string
          homework_id: string
          instructions: string
          is_overdue: boolean
          marks_obtained: number
          max_marks: number
          section_label: string
          status: string
          subject_code: string
          subject_name: string
          submission_file_count: number
          submission_id: string
          submitted_at: string
          title: string
        }[]
      }
      homework_grade: {
        Args: {
          p_feedback?: string
          p_marks?: number
          p_return?: boolean
          p_submission_id: string
        }
        Returns: {
          created_at: string
          feedback: string | null
          graded_at: string | null
          graded_by: string | null
          homework_id: string
          id: string
          marks_obtained: number | null
          max_marks: number | null
          note: string | null
          session_id: string
          status: string
          student_id: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "homework_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      homework_publish: { Args: { p_homework_id: string }; Returns: number }
      homework_submission_sheet: {
        Args: { p_homework_id: string }
        Returns: {
          admission_number: string
          feedback: string
          file_count: number
          is_late: boolean
          marks_obtained: number
          max_marks: number
          note: string
          roll_number: string
          status: string
          student_id: string
          student_name: string
          submission_id: string
          submitted_at: string
        }[]
      }
      homework_submit: {
        Args: { p_homework_id: string; p_note?: string }
        Returns: {
          created_at: string
          feedback: string | null
          graded_at: string | null
          graded_by: string | null
          homework_id: string
          id: string
          marks_obtained: number | null
          max_marks: number | null
          note: string | null
          session_id: string
          status: string
          student_id: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "homework_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      homework_unpublish: {
        Args: { p_homework_id: string }
        Returns: undefined
      }
      homework_unsubmit: { Args: { p_homework_id: string }; Returns: undefined }
      hr_attendance_sheet: {
        Args: { p_date: string }
        Returns: {
          check_in: string
          check_out: string
          department: string
          designation: string
          employee_code: string
          is_working_day: boolean
          leave_type_name: string
          note: string
          staff_id: string
          staff_name: string
          status: string
        }[]
      }
      hr_cancel_leave: { Args: { p_request_id: string }; Returns: undefined }
      hr_decide_leave: {
        Args: { p_approve: boolean; p_note?: string; p_request_id: string }
        Returns: number
      }
      hr_format_days: { Args: { p_days: number }; Returns: string }
      hr_leave_balance: {
        Args: { p_session_id?: string; p_staff_id?: string }
        Returns: {
          annual_quota_days: number
          code: string
          is_paid: boolean
          leave_type_id: string
          name: string
          pending_days: number
          remaining_days: number
          taken_days: number
        }[]
      }
      hr_leave_days: {
        Args: {
          p_ends_on: string
          p_half_end?: boolean
          p_half_start?: boolean
          p_starts_on: string
        }
        Returns: number
      }
      hr_mark_attendance: {
        Args: { p_date: string; p_entries: Json }
        Returns: number
      }
      hr_working_days: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      library_issue_book: {
        Args: { p_book_id: string; p_due_at?: string; p_member_id: string }
        Returns: {
          book_id: string
          created_at: string
          due_at: string
          fine_amount: number
          id: string
          issued_at: string
          issued_by: string | null
          member_id: string
          returned_at: string | null
          returned_by: string | null
          session_id: string
          staff_fine_payslip_id: string | null
          staff_fine_waived_at: string | null
          staff_fine_waived_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "book_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      library_return_book: {
        Args: { p_fine_per_day?: number; p_issue_id: string }
        Returns: {
          book_id: string
          created_at: string
          due_at: string
          fine_amount: number
          id: string
          issued_at: string
          issued_by: string | null
          member_id: string
          returned_at: string | null
          returned_by: string | null
          session_id: string
          staff_fine_payslip_id: string | null
          staff_fine_waived_at: string | null
          staff_fine_waived_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "book_issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      library_waive_staff_fine: {
        Args: { p_issue_id: string; p_note?: string }
        Returns: undefined
      }
      mark_attendance: {
        Args: {
          p_date: string
          p_entries: Json
          p_period?: number
          p_section_id: string
        }
        Returns: number
      }
      notify_claim_deliveries: {
        Args: { p_limit?: number }
        Returns: {
          address: string | null
          attempts: number
          body: string
          channel: string
          created_at: string
          id: string
          last_error: string | null
          next_attempt_at: string
          notification_id: string
          read_at: string | null
          recipient_user_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          tenant_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      notify_event_types: {
        Args: never
        Returns: {
          default_channels: string[]
          description: string
          key: string
          name: string
        }[]
      }
      notify_inbox: {
        Args: { p_limit?: number; p_only_unread?: boolean }
        Returns: {
          body: string
          created_at: string
          event_key: string
          event_name: string
          id: string
          notification_id: string
          read_at: string
          subject: string
        }[]
      }
      notify_mark_all_read: { Args: never; Returns: number }
      notify_outbox: {
        Args: { p_event_key?: string; p_limit?: number }
        Returns: {
          audience: Json
          body: string
          created_at: string
          created_by_name: string
          deliveries: number
          event_key: string
          event_name: string
          failed: number
          id: string
          queued: number
          recipients: number
          sent: number
          skipped: number
          subject: string
        }[]
      }
      notify_record_result: {
        Args: { p_delivery_id: string; p_error?: string; p_ok: boolean }
        Returns: undefined
      }
      notify_render: {
        Args: { p_payload: Json; p_template: string }
        Returns: string
      }
      notify_resolve_audience: {
        Args: { p_audience: Json; p_tenant_id: string }
        Returns: {
          user_id: string
        }[]
      }
      notify_send: {
        Args: {
          p_audience: Json
          p_body: string
          p_channels?: string[]
          p_event_key: string
          p_payload?: Json
          p_subject: string
        }
        Returns: {
          audience: Json
          body: string
          created_at: string
          created_by: string | null
          event_key: string
          id: string
          payload: Json
          session_id: string
          subject: string | null
          tenant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notify_unread_count: { Args: never; Returns: number }
      payroll_discard: { Args: { p_run_id: string }; Returns: undefined }
      payroll_evaluate: {
        Args: {
          p_components: Json
          p_employed_days?: number
          p_lop_days: number
          p_overrides: Json
          p_working_days: number
        }
        Returns: Json
      }
      payroll_finalise: { Args: { p_run_id: string }; Returns: number }
      payroll_lop_days: {
        Args: { p_from: string; p_staff_id: string; p_to: string }
        Returns: number
      }
      payroll_paid_for_month: {
        Args: { p_period_month: string; p_staff_id: string }
        Returns: number
      }
      payroll_payslip_paid: { Args: { p_payslip_id: string }; Returns: number }
      payroll_preview: {
        Args: { p_kind?: string; p_note?: string; p_period_month: string }
        Returns: string
      }
      payroll_recompute_payslip: {
        Args: { p_payslip_id: string }
        Returns: undefined
      }
      payroll_record_payment: {
        Args: {
          p_amount: number
          p_method?: string
          p_note?: string
          p_paid_on?: string
          p_payslip_id: string
          p_reference?: string
        }
        Returns: string
      }
      payroll_register: {
        Args: { p_run_id: string }
        Returns: {
          amount_paid: number
          designation: string
          employed_days: number
          employee_code: string
          gross_earnings: number
          has_left: boolean
          is_override: boolean
          lop_days: number
          net_pay: number
          note: string
          paid_days: number
          payslip_id: string
          staff_id: string
          staff_name: string
          structure_name: string
          total_deductions: number
          working_days: number
        }[]
      }
      payroll_reverse_payment: {
        Args: { p_note?: string; p_payment_id: string }
        Returns: string
      }
      payroll_staff_library_fines: {
        Args: { p_staff_id: string }
        Returns: {
          fine_amount: number
          issue_id: string
        }[]
      }
      promotion_apply: {
        Args: { p_run_id: string }
        Returns: {
          carried: number
          graduated: number
          held: number
          promoted: number
          repeated: number
        }[]
      }
      promotion_discard_run: { Args: { p_run_id: string }; Returns: undefined }
      promotion_preview: {
        Args: {
          p_from_session_id: string
          p_rules?: Json
          p_to_session_id: string
        }
        Returns: {
          admission_number: string
          attendance_percent: number
          decision: string
          exam_result: string
          from_enrolment_id: string
          from_section_id: string
          from_section_label: string
          from_sequence: number
          outstanding: number
          reason: string
          roll_number: string
          student_id: string
          student_name: string
          subjects_failed: number
          to_section_id: string
          to_section_label: string
        }[]
      }
      promotion_rule_problems: {
        Args: { p_rules: Json }
        Returns: {
          problem: string
        }[]
      }
      promotion_start_run: {
        Args: {
          p_from_session_id: string
          p_rules?: Json
          p_to_session_id: string
        }
        Returns: string
      }
      report_attendance_summary: {
        Args: { p_params: Json }
        Returns: {
          row_data: Json
        }[]
      }
      report_day_bounds: {
        Args: { p_from: string; p_to: string }
        Returns: {
          from_ts: string
          to_ts: string
        }[]
      }
      report_fee_collection: {
        Args: { p_params: Json }
        Returns: {
          row_data: Json
        }[]
      }
      report_fee_defaulters: {
        Args: { p_params: Json }
        Returns: {
          row_data: Json
        }[]
      }
      report_library_overdue: {
        Args: { p_params: Json }
        Returns: {
          row_data: Json
        }[]
      }
      report_list: {
        Args: never
        Returns: {
          columns: Json
          description: string
          key: string
          module: string
          name: string
          parameters: Json
        }[]
      }
      report_notification_deliveries: {
        Args: { p_params: Json }
        Returns: {
          row_data: Json
        }[]
      }
      report_param_date: {
        Args: { p_default?: string; p_name: string; p_params: Json }
        Returns: string
      }
      report_param_numeric: {
        Args: { p_default?: number; p_name: string; p_params: Json }
        Returns: number
      }
      report_param_text: {
        Args: { p_default?: string; p_name: string; p_params: Json }
        Returns: string
      }
      report_param_uuid: {
        Args: { p_name: string; p_params: Json }
        Returns: string
      }
      report_run: {
        Args: { p_key: string; p_limit?: number; p_params?: Json }
        Returns: {
          row_data: Json
          total_count: number
        }[]
      }
      report_section_routine: {
        Args: { p_params: Json }
        Returns: {
          row_data: Json
        }[]
      }
      report_student_roster: {
        Args: { p_params: Json }
        Returns: {
          row_data: Json
        }[]
      }
      report_teacher_load: {
        Args: { p_params: Json }
        Returns: {
          row_data: Json
        }[]
      }
      salary_structure_problems: {
        Args: { p_components: Json }
        Returns: string[]
      }
      schema_guard_violations: {
        Args: never
        Returns: {
          has_tenant_id: boolean
          rls_enabled: boolean
          table_name: string
        }[]
      }
      storage_object_tenant_matches: {
        Args: { p_name: string }
        Returns: boolean
      }
      timetable_busy_in_slot: {
        Args: {
          p_section_id?: string
          p_time_slot_id: string
          p_weekday: number
        }
        Returns: {
          busy_with: string
          entity: string
          entity_id: string
        }[]
      }
      timetable_copy_day: {
        Args: {
          p_from_weekday: number
          p_section_id: string
          p_to_weekday: number
        }
        Returns: {
          copied: number
          skipped: number
        }[]
      }
      timetable_describe_entry: {
        Args: { p_entry_id: string }
        Returns: string
      }
      timetable_for_section: {
        Args: { p_section_id: string }
        Returns: {
          class_room_id: string
          ends_at: string
          id: string
          note: string
          period_number: number
          room_name: string
          slot_label: string
          starts_at: string
          subject_code: string
          subject_id: string
          subject_name: string
          teacher_name: string
          teacher_staff_id: string
          time_slot_id: string
          weekday: number
        }[]
      }
      timetable_for_teacher: {
        Args: { p_staff_id?: string }
        Returns: {
          ends_at: string
          id: string
          period_number: number
          room_name: string
          section_id: string
          section_label: string
          starts_at: string
          subject_code: string
          subject_name: string
          time_slot_id: string
          weekday: number
        }[]
      }
      timetable_set_entry: {
        Args: {
          p_class_room_id?: string
          p_note?: string
          p_section_id: string
          p_subject_id: string
          p_teacher_staff_id?: string
          p_time_slot_id: string
          p_weekday: number
        }
        Returns: {
          class_room_id: string | null
          created_at: string
          id: string
          note: string | null
          section_id: string
          session_id: string
          slot_schedulable: boolean
          subject_id: string
          teacher_staff_id: string | null
          tenant_id: string
          time_slot_id: string
          updated_at: string
          weekday: number
        }
        SetofOptions: {
          from: "*"
          to: "timetable_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      timetable_teacher_load: {
        Args: never
        Returns: {
          employee_code: string
          periods: number
          sections: number
          staff_id: string
          subjects: number
          teacher_name: string
        }[]
      }
      transport_assign_student: {
        Args: {
          p_direction?: string
          p_ends_on?: string
          p_starts_on?: string
          p_stop_id: string
          p_student_id: string
        }
        Returns: string
      }
      transport_billing_conflicts: {
        Args: never
        Returns: {
          problem: string
        }[]
      }
      transport_cancel_assignment: {
        Args: { p_assignment_id: string; p_reason?: string }
        Returns: boolean
      }
      transport_end_assignment: {
        Args: { p_assignment_id: string; p_ends_on?: string }
        Returns: string
      }
      transport_fee_lines: {
        Args: { p_as_of?: string; p_student_id: string }
        Returns: {
          amount: number
          description: string
          fee_head_id: string
        }[]
      }
      transport_for_student: {
        Args: { p_student_id: string }
        Returns: {
          assignment_id: string
          direction: string
          drop_time: string
          ends_on: string
          landmark: string
          monthly_fare: number
          pickup_time: string
          registration_number: string
          route_code: string
          route_name: string
          starts_on: string
          status: string
          stop_name: string
        }[]
      }
      transport_manifest: {
        Args: { p_route_id: string }
        Returns: {
          admission_number: string
          direction: string
          drop_time: string
          guardian_name: string
          guardian_phone: string
          landmark: string
          pickup_time: string
          section_label: string
          sequence: number
          stop_id: string
          stop_name: string
          student_id: string
          student_name: string
        }[]
      }
      transport_route_load: {
        Args: { p_session_id?: string }
        Returns: {
          assigned: number
          capacity: number
          code: string
          direction: string
          driver_name: string
          is_active: boolean
          monthly_revenue: number
          name: string
          registration_number: string
          route_id: string
          seats_free: number
          stop_count: number
          vehicle_id: string
        }[]
      }
      transport_stop_options: {
        Args: { p_session_id?: string }
        Returns: {
          drop_time: string
          landmark: string
          monthly_fare: number
          pickup_time: string
          route_code: string
          route_direction: string
          route_id: string
          route_is_active: boolean
          route_name: string
          seats_free: number
          sequence: number
          stop_id: string
          stop_name: string
        }[]
      }
      update_student: {
        Args: {
          p_admission_date: string
          p_admission_number: string
          p_person: Json
          p_roll_number?: string
          p_section_id?: string
          p_status: string
          p_student_id: string
        }
        Returns: {
          admission_date: string
          admission_number: string
          created_at: string
          id: string
          person_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "students"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
